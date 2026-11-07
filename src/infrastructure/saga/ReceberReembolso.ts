import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { forwardTrace } from '../observability/TraceContext';
export type RefundEvent = {
  messageId: string;
  operationId: string;
  osId: string;
  sagaId: string;
  filialId: string;
  correlationId: string;
  type: 'billing.payment-refunded.v1';
  producer: 'soat-billing-service';
  data: {
    refundId: string;
    paymentId: string;
    chargeId: string;
    quoteId: string;
    quoteVersion: number;
    amountInCents: number;
    currency: string;
    providerOrderId: string;
    providerRefundId: string;
    cancelOperationId: string;
  };
};
type Saga = {
  osId: string;
  filialId: string;
  status: string;
  version: number;
  chargeId: string | null;
  reservationId: string | null;
  quoteId: string | null;
  quoteVersion: number | null;
  requiresAttention: boolean;
  lastError: string | null;
};
export class ReceiveRefundEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    event: RefundEvent,
    now = new Date(),
  ): Promise<'APPLIED' | 'PENDING'> {
    const d = event?.data;
    if (
      event?.type !== 'billing.payment-refunded.v1' ||
      event?.producer !== 'soat-billing-service' ||
      ![
        event.messageId,
        event.operationId,
        event.osId,
        event.sagaId,
        event.filialId,
        event.correlationId,
        d?.refundId,
        d?.paymentId,
        d?.chargeId,
        d?.quoteId,
        d?.providerOrderId,
        d?.providerRefundId,
        d?.cancelOperationId,
      ].every((id) => typeof id === 'string' && id.length > 0) ||
      !Number.isSafeInteger(d.quoteVersion) ||
      d.quoteVersion < 1 ||
      !Number.isSafeInteger(d.amountInCents) ||
      d.amountInCents < 1 ||
      d.currency !== 'BRL' ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Reembolso inválido');
    const encoded = JSON.stringify(event);
    const consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Saga[]
      >`SELECT "osId", "filialId", "status", "version", "chargeId", "reservationId", "quoteId", "quoteVersion", "requiresAttention", "lastError" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
      const saga = rows[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Saga não corresponde ao reembolso');
      const commands = await tx.$queryRaw<
        Array<{
          status: string;
          payload: {
            data: {
              refundId: string;
              paymentId: string;
              cancelOperationId: string;
              cancelEventId: string;
            };
          };
          sameResult: boolean | null;
        }>
      >`SELECT op."status", o."payload", (op."result"->'data' = ${JSON.stringify(d)}::jsonb) AS "sameResult" FROM "SagaOperation" op JOIN "Outbox" o ON o."payload"->>'operationId' = op."operationId" WHERE op."operationId" = ${event.operationId} AND op."sagaId" = ${event.sagaId} AND op."commandType" = 'billing.refund-payment.v1' AND o."type" = 'billing.refund-payment.v1'`;
      const command = commands[0];
      if (
        commands.length !== 1 ||
        command.payload?.data?.refundId !== d.refundId ||
        command.payload.data.paymentId !== d.paymentId ||
        command.payload.data.cancelOperationId !== d.cancelOperationId
      )
        throw new Error('Reembolso diverge do comando');
      const payments = await tx.$queryRaw<
        Array<{ matches: boolean }>
      >`SELECT ("payload"->'data'->>'paymentId' = ${d.paymentId} AND "payload"->'data'->>'chargeId' = ${d.chargeId} AND "payload"->'data'->>'providerOrderId' = ${d.providerOrderId} AND "payload"->'data'->>'amountInCents' = ${String(d.amountInCents)}) AS "matches" FROM "Inbox" WHERE "consumer" = ${consumer} AND "type" = 'billing.payment-confirmed.v1' AND "status" = 'APPLIED' AND "payload"->>'sagaId' = ${event.sagaId}`;
      if (!payments.some((payment) => payment.matches))
        throw new Error('Pagamento não corresponde ao reembolso');
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches) throw new Error('Mensagem reutilizada');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      if (command.status === 'SUCCEEDED') {
        if (!command.sameResult) throw new Error('Reembolso divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      let recovering = false;
      if (
        saga.status === 'RECONCILIACAO_NECESSARIA' &&
        saga.requiresAttention &&
        saga.lastError === 'REFUND_RESULT_UNKNOWN' &&
        typeof command.payload.data.cancelEventId === 'string'
      ) {
        const proof = await tx.$queryRaw<Array<{ safe: boolean }>>`
          SELECT
            EXISTS (SELECT 1 FROM "Inbox" WHERE "consumer"=${consumer} AND "type"='billing.refund-blocked.v1' AND "operationId"=${event.operationId} AND "status"='APPLIED' AND "payload"->>'sagaId'=${event.sagaId} AND "payload"->'data'->>'reasonCode'='PROVIDER_RESULT_UNKNOWN')
            AND NOT EXISTS (SELECT 1 FROM "Inbox" WHERE "consumer"=${consumer} AND "type"='billing.refund-blocked.v1' AND "payload"->>'sagaId'=${event.sagaId} AND "payload"->'data'->>'reasonCode'='EVIDENCE_MISMATCH')
            AND EXISTS (SELECT 1 FROM "Inbox" WHERE "consumer"=${consumer} AND "messageId"=${command.payload.data.cancelEventId} AND "type"='execution.work-cancelled.v1' AND "operationId"=${d.cancelOperationId} AND "status"='APPLIED' AND "payload"->>'sagaId'=${event.sagaId} AND "payload"->'data'->>'outcome'='CANCELLED')
            AND NOT EXISTS (SELECT 1 FROM "Inbox" WHERE "consumer"=${consumer} AND "payload"->>'sagaId'=${event.sagaId} AND "type" IN ('execution.work-started.v1','execution.work-completed.v1'))
            AND NOT EXISTS (SELECT 1 FROM "Inbox" WHERE "consumer"=${consumer} AND "payload"->>'sagaId'=${event.sagaId} AND "type"='execution.work-cancelled.v1' AND "payload"->'data'->>'outcome'='ALREADY_STARTED')
            AND NOT EXISTS (SELECT 1 FROM "SagaOperation" WHERE "sagaId"=${event.sagaId} AND "commandType"='execution.cancel-work.v1' AND "operationId"<>${d.cancelOperationId})
            AND NOT EXISTS (SELECT 1 FROM "SagaOperation" WHERE "sagaId"=${event.sagaId} AND "commandType"='execution.release-parts.v1') AS safe`;
        recovering = proof[0]?.safe === true;
      }
      if (
        (saga.status !== 'REEMBOLSO_PENDENTE' && !recovering) ||
        saga.chargeId !== d.chargeId ||
        saga.quoteId !== d.quoteId ||
        saga.quoteVersion !== d.quoteVersion ||
        !saga.reservationId ||
        !['PENDING', 'SENT'].includes(command.status)
      )
        return 'PENDING';
      const operationId = randomUUID();
      const messageId = randomUUID();
      const type = 'execution.release-parts.v1';
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
          reservationId: saga.reservationId,
          cancelOperationId: d.cancelOperationId,
          reason: 'SAGA_COMPENSATION',
        },
      };
      await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${event.sagaId}, 'RELEASE_PARTS', 1, ${type}, 'PENDING', NOW())`;
      await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'LIBERACAO_PENDENTE', "requiresAttention" = CASE WHEN ${recovering} THEN false ELSE "requiresAttention" END, "lastError" = CASE WHEN ${recovering} THEN NULL ELSE "lastError" END, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      if (recovering)
        await tx.$executeRaw`INSERT INTO "SagaRecoveryAudit" ("id","sagaId","messageId","actorId","reason") VALUES (${randomUUID()},${event.sagaId},${event.messageId},'saga-worker','AUTHENTICATED_REFUND_CONFIRMED')`;
      await tx.$executeRaw`UPDATE "SagaOperation" SET "status" = 'SUCCEEDED', "result" = ${encoded}::jsonb, "updatedAt" = NOW() WHERE "operationId" = ${event.operationId}`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
