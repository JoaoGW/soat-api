import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { forwardTrace } from '../observability/TraceContext';

export type ChargeCancellationEvent = {
  messageId: string;
  operationId: string;
  osId: string;
  sagaId: string;
  filialId: string;
  correlationId: string;
  type: 'billing.charge-canceled.v1';
  producer: 'soat-billing-service';
  data: {
    chargeId: string;
    quoteId: string;
    quoteVersion: number;
    providerOrderId: string;
    reservationId: string;
    cancelOperationId: string;
    cancelEventId: string;
  };
};

/** The caller verifies Billing's signature and schema. No physical or financial uncertainty is resolved by assumption. */
export class ReceiveChargeCancellation {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    event: ChargeCancellationEvent,
    now = new Date(),
  ): Promise<'APPLIED' | 'PENDING'> {
    const d = event?.data;
    if (
      event?.type !== 'billing.charge-canceled.v1' ||
      event?.producer !== 'soat-billing-service' ||
      ![
        event.messageId,
        event.operationId,
        event.osId,
        event.sagaId,
        event.filialId,
        event.correlationId,
        d?.chargeId,
        d?.quoteId,
        d?.providerOrderId,
        d?.reservationId,
        d?.cancelOperationId,
        d?.cancelEventId,
      ].every((v) => typeof v === 'string' && v.length > 0) ||
      !Number.isSafeInteger(d.quoteVersion) ||
      d.quoteVersion < 1 ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Cancelamento de cobrança inválido');
    const encoded = JSON.stringify(event),
      consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          osId: string;
          filialId: string;
          status: string;
          version: number;
          requiresAttention: boolean;
          lastError: string | null;
          chargeId: string | null;
          quoteId: string | null;
          quoteVersion: number | null;
          reservationId: string | null;
        }>
      >`SELECT "osId", "filialId", "status", "version", "requiresAttention", "lastError", "chargeId", "quoteId", "quoteVersion", "reservationId" FROM "SagaInstance" WHERE "id"=${event.sagaId} FOR UPDATE`;
      const saga = rows[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Saga divergente');
      const ops = await tx.$queryRaw<
        Array<{
          status: string;
          sameResult: boolean | null;
          payload: {
            data: {
              chargeId: string;
              reservationId: string;
              cancelOperationId: string;
              cancelEventId: string;
            };
          };
        }>
      >`SELECT op."status", (op."result"->'data'=${JSON.stringify(d)}::jsonb) AS "sameResult", o."payload" FROM "SagaOperation" op JOIN "Outbox" o ON o."payload"->>'operationId'=op."operationId" WHERE op."sagaId"=${event.sagaId} AND op."operationId"=${event.operationId} AND op."commandType"='billing.cancel-charge.v1' AND o."type"='billing.cancel-charge.v1'`;
      const command = ops[0]?.payload?.data;
      if (
        ops.length !== 1 ||
        command?.chargeId !== d.chargeId ||
        command.reservationId !== d.reservationId ||
        command.cancelOperationId !== d.cancelOperationId ||
        command.cancelEventId !== d.cancelEventId
      )
        throw new Error('Cancelamento financeiro diverge do comando');
      const evidence = await tx.$queryRaw<
        Array<{ safe: boolean }>
      >`SELECT EXISTS (SELECT 1 FROM "SagaOperation" WHERE "sagaId"=${event.sagaId} AND "commandType"='billing.create-charge.v1' AND "status"='SUCCEEDED' AND "result"->'data'->>'chargeId'=${d.chargeId} AND "result"->'data'->>'providerOrderId'=${d.providerOrderId}) AND EXISTS (SELECT 1 FROM "Inbox" WHERE "consumer"=${consumer} AND "messageId"=${d.cancelEventId} AND "operationId"=${d.cancelOperationId} AND "type"='execution.work-cancelled.v1' AND "status"='APPLIED' AND "payload"->>'sagaId'=${event.sagaId} AND "payload"->'data'->>'outcome'='CANCELLED') AS safe`;
      if (!evidence[0]?.safe)
        throw new Error('Evidência de cancelamento ausente');
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId"=${event.operationId} AND "type"=${event.type} AND "payload"=${encoded}::jsonb) AS matches, "status" FROM "Inbox" WHERE "consumer"=${consumer} AND "messageId"=${event.messageId}`;
      if (!inbox[0]?.matches) throw new Error('Mensagem reutilizada');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      if (ops[0].status === 'SUCCEEDED') {
        if (!ops[0].sameResult) throw new Error('Resultado divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status"='APPLIED', "appliedAt"=NOW() WHERE "consumer"=${consumer} AND "messageId"=${event.messageId}`;
        return 'APPLIED';
      }
      if (
        saga.status !== 'RECONCILIACAO_NECESSARIA' ||
        !saga.requiresAttention ||
        saga.lastError !== 'CHARGE_CANCEL_PENDING' ||
        saga.chargeId !== d.chargeId ||
        saga.quoteId !== d.quoteId ||
        saga.quoteVersion !== d.quoteVersion ||
        saga.reservationId !== d.reservationId ||
        !['PENDING', 'SENT'].includes(ops[0].status)
      )
        return 'PENDING';
      const conflicts = await tx.$queryRaw<
        Array<{ present: boolean }>
      >`SELECT EXISTS (SELECT 1 FROM "Inbox" WHERE "consumer"=${consumer} AND "payload"->>'sagaId'=${event.sagaId} AND ("type" IN ('billing.payment-confirmed.v1','billing.refund-blocked.v1','execution.work-started.v1','execution.work-completed.v1') OR ("type"='execution.work-cancelled.v1' AND "payload"->'data'->>'outcome'='ALREADY_STARTED'))) OR EXISTS (SELECT 1 FROM "SagaOperation" WHERE "sagaId"=${event.sagaId} AND ("commandType" IN ('execution.release-parts.v1','billing.refund-payment.v1') OR ("commandType"='execution.cancel-work.v1' AND "operationId"<>${d.cancelOperationId}))) AS present`;
      if (conflicts[0]?.present) {
        await tx.$executeRaw`UPDATE "SagaInstance" SET "lastError"='CHARGE_CANCEL_CONFLICT', "version"="version"+1, "updatedAt"=NOW() WHERE "id"=${event.sagaId}`;
        await tx.$executeRaw`UPDATE "Inbox" SET "status"='APPLIED', "appliedAt"=NOW() WHERE "consumer"=${consumer} AND "messageId"=${event.messageId}`;
        return 'APPLIED';
      }
      const operationId = randomUUID(),
        messageId = randomUUID(),
        type = 'execution.release-parts.v1';
      const payload = {
        messageId,
        type,
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        producer: 'soat-os-service',
        aggregateType: 'saga',
        aggregateId: event.sagaId,
        aggregateVersion: saga.version + 1,
        osId: event.osId,
        sagaId: event.sagaId,
        filialId: event.filialId,
        correlationId: event.correlationId,
        ...forwardTrace(event),
        causationId: event.messageId,
        operationId,
        data: {
          reservationId: d.reservationId,
          cancelOperationId: d.cancelOperationId,
          reason: 'SAGA_COMPENSATION',
        },
      };
      await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${event.sagaId}, 'RELEASE_PARTS', 1, ${type}, 'PENDING', NOW())`;
      await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status"='LIBERACAO_PENDENTE', "requiresAttention"=false, "lastError"=NULL, "version"="version"+1, "updatedAt"=NOW() WHERE "id"=${event.sagaId}`;
      await tx.$executeRaw`INSERT INTO "SagaRecoveryAudit" ("id", "sagaId", "messageId", "actorId", "reason") VALUES (${randomUUID()}, ${event.sagaId}, ${event.messageId}, 'saga-worker', 'AUTHENTICATED_CHARGE_CANCELED')`;
      await tx.$executeRaw`UPDATE "SagaOperation" SET "status"='SUCCEEDED', "result"=${encoded}::jsonb, "updatedAt"=NOW() WHERE "operationId"=${event.operationId}`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status"='APPLIED', "appliedAt"=NOW() WHERE "consumer"=${consumer} AND "messageId"=${event.messageId}`;
      return 'APPLIED';
    });
  }
}
