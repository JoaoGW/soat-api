import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
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
      >`SELECT "osId", "filialId", "status", "version", "chargeId", "reservationId", "quoteId", "quoteVersion" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
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
      if (
        saga.status !== 'REEMBOLSO_PENDENTE' ||
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
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'LIBERACAO_PENDENTE', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      await tx.$executeRaw`UPDATE "SagaOperation" SET "status" = 'SUCCEEDED', "result" = ${encoded}::jsonb, "updatedAt" = NOW() WHERE "operationId" = ${event.operationId}`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
