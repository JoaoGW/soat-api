import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

export type PaymentEvent = {
  messageId: string;
  type: 'billing.payment-confirmed.v1';
  producer: 'soat-billing-service';
  operationId: string;
  sagaId: string;
  osId: string;
  filialId: string;
  correlationId: string;
  traceparent?: string;
  tracestate?: string;
  data: {
    chargeId: string;
    quoteId: string;
    quoteVersion: number;
    paymentId: string;
    providerOrderId: string;
    providerPaymentId: string;
    amountInCents: number;
    currency: string;
    paidAt: string;
  };
  [key: string]: unknown;
};
type Saga = {
  id: string;
  osId: string;
  filialId: string;
  status: string;
  version: number;
  quoteId: string | null;
  quoteVersion: number | null;
  reservationId: string | null;
  chargeId: string | null;
};
type Command = { payload: { data?: Record<string, unknown> } };

/** Requires schema and transport validation; enqueues only after matching a confirmed reservation. */
export class ReceivePaymentEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(event: PaymentEvent): Promise<'APPLIED' | 'PENDING'> {
    if (
      !event ||
      event.type !== 'billing.payment-confirmed.v1' ||
      event.producer !== 'soat-billing-service' ||
      ![
        event.messageId,
        event.operationId,
        event.sagaId,
        event.osId,
        event.filialId,
        event.correlationId,
        event.data?.chargeId,
        event.data?.quoteId,
        event.data?.paymentId,
        event.data?.providerOrderId,
        event.data?.providerPaymentId,
      ].every((value) => typeof value === 'string' && value.length > 0) ||
      !Number.isSafeInteger(event.data.quoteVersion) ||
      event.data.quoteVersion < 1 ||
      !Number.isSafeInteger(event.data.amountInCents) ||
      event.data.amountInCents < 1 ||
      event.data.currency !== 'BRL' ||
      !Number.isFinite(Date.parse(event.data.paidAt))
    )
      throw new Error('Evento de pagamento inválido');
    const encoded = JSON.stringify(event);
    return this.db.$transaction(async (tx) => {
      const sagas = await tx.$queryRaw<
        Saga[]
      >`SELECT "id", "osId", "filialId", "status", "version", "quoteId", "quoteVersion", "reservationId", "chargeId" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
      const saga = sagas[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Saga não corresponde ao pagamento');
      const ops = await tx.$queryRaw<
        Array<{ status: string; providerOrderId: string | null }>
      >`SELECT "status", "result"->'data'->>'providerOrderId' AS "providerOrderId" FROM "SagaOperation" WHERE "operationId" = ${event.operationId} AND "sagaId" = ${event.sagaId} AND "commandType" = 'billing.create-charge.v1'`;
      if (!ops[0]) throw new Error('Operação não corresponde ao pagamento');
      const commands = await tx.$queryRaw<
        Command[]
      >`SELECT "payload" FROM "Outbox" WHERE "type" = 'billing.create-charge.v1' AND "payload"->>'operationId' = ${event.operationId} AND "payload"->>'sagaId' = ${event.sagaId}`;
      const command = commands[0]?.payload?.data;
      if (
        !command ||
        command.quoteId !== event.data.quoteId ||
        command.quoteVersion !== event.data.quoteVersion ||
        command.chargeId !== event.data.chargeId ||
        command.totalInCents !== event.data.amountInCents ||
        command.currency !== event.data.currency ||
        typeof command.reservationId !== 'string' ||
        !command.reservationId
      )
        throw new Error('Pagamento diverge do comando');
      const consumer = 'os.saga-events';
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches)
        throw new Error('Mensagem reutilizada com outro conteúdo');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      const existing = await tx.$queryRaw<
        Array<{ matches: boolean }>
      >`SELECT ("payload"->'data'->>'paymentId' = ${event.data.paymentId} AND "payload"->'data'->>'chargeId' = ${event.data.chargeId} AND "payload"->'data'->>'providerOrderId' = ${event.data.providerOrderId} AND "payload"->'data'->>'providerPaymentId' = ${event.data.providerPaymentId}) AS "matches" FROM "Outbox" WHERE "type" = 'execution.enqueue-work.v1' AND "payload"->>'sagaId' = ${event.sagaId}`;
      if (existing.some((entry) => entry.matches)) {
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        [
          'COMPENSANDO',
          'COMPENSADA',
          'RECONCILIACAO_NECESSARIA',
          'EM_EXECUCAO',
          'CONCLUIDA',
        ].includes(saga.status) ||
        existing.length > 0 ||
        (ops[0].status === 'SUCCEEDED' &&
          ops[0].providerOrderId !== event.data.providerOrderId)
      ) {
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        saga.status !== 'AGUARDANDO_PAGAMENTO' ||
        saga.chargeId !== event.data.chargeId ||
        saga.quoteId !== event.data.quoteId ||
        saga.quoteVersion !== event.data.quoteVersion ||
        saga.reservationId !== command.reservationId ||
        ops[0].status !== 'SUCCEEDED'
      )
        return 'PENDING';
      const reservations = await tx.$queryRaw<
        Array<{ operationId: string }>
      >`SELECT "operationId" FROM "SagaOperation" WHERE "sagaId" = ${event.sagaId} AND "commandType" = 'execution.reserve-parts.v1' AND "status" = 'SUCCEEDED' AND "result"->'data'->>'reservationId' = ${saga.reservationId} AND "result"->'data'->>'quoteId' = ${event.data.quoteId} AND "result"->'data'->>'quoteVersion' = ${String(event.data.quoteVersion)} LIMIT 1`;
      if (!reservations.length) return 'PENDING';
      const operationId = randomUUID();
      const messageId = randomUUID();
      const executionId = randomUUID();
      const type = 'execution.enqueue-work.v1';
      const payload = {
        messageId,
        type,
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        producer: 'soat-os-service',
        aggregateType: 'saga',
        aggregateId: saga.id,
        aggregateVersion: saga.version + 1,
        osId: saga.osId,
        sagaId: saga.id,
        filialId: saga.filialId,
        correlationId: event.correlationId,
        causationId: event.messageId,
        operationId,
        ...(event.traceparent ? { traceparent: event.traceparent } : {}),
        ...(event.tracestate ? { tracestate: event.tracestate } : {}),
        data: {
          quoteId: event.data.quoteId,
          quoteVersion: event.data.quoteVersion,
          reservationId: saga.reservationId,
          executionId,
          chargeId: event.data.chargeId,
          paymentId: event.data.paymentId,
          providerOrderId: event.data.providerOrderId,
          providerPaymentId: event.data.providerPaymentId,
        },
      };
      await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${saga.id}, 'ENQUEUE_WORK', 1, ${type}, 'PENDING', NOW())`;
      await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'FILA_PENDENTE', "executionId" = ${executionId}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${saga.id}`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
