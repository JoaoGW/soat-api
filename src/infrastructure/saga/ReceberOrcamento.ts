import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { forwardTrace } from '../observability/TraceContext';

type Item = {
  sourceId: string;
  itemType: 'PART' | 'SERVICE';
  quantity: number;
  unitPriceInCents: number;
};
export type QuoteEvent = {
  messageId: string;
  operationId: string;
  sagaId: string;
  osId: string;
  filialId: string;
  correlationId: string;
  type:
    | 'billing.quote-issued.v1'
    | 'billing.quote-approved.v1'
    | 'billing.quote-rejected.v1';
  producer: 'soat-billing-service';
  data: {
    quoteId: string;
    quoteVersion: number;
    clientId: string;
    totalInCents?: number;
    currency?: string;
    expiresAt?: string;
  };
};
type Saga = {
  osId: string;
  filialId: string;
  status: string;
  version: number;
  quoteId: string | null;
  quoteVersion: number | null;
  clienteId: string;
};
type QuoteCommand = {
  payload: { data: { clienteId: string; expiresAt: string; items: Item[] } };
  operationId: string;
  status: string;
};
/** Schema e assinatura são verificados antes de receber o fato. */
export class ReceiveQuoteEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    event: QuoteEvent,
    now = new Date(),
  ): Promise<'APPLIED' | 'PENDING'> {
    const issued = event?.type === 'billing.quote-issued.v1';
    const approved = event?.type === 'billing.quote-approved.v1';
    const rejected = event?.type === 'billing.quote-rejected.v1';
    if (
      (!issued && !approved && !rejected) ||
      event.producer !== 'soat-billing-service' ||
      ![
        event.messageId,
        event.operationId,
        event.sagaId,
        event.osId,
        event.filialId,
        event.correlationId,
        event.data?.quoteId,
        event.data?.clientId,
      ].every((id) => typeof id === 'string' && id.length > 0) ||
      !Number.isSafeInteger(event.data.quoteVersion) ||
      event.data.quoteVersion < 1 ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Evento de orçamento inválido');
    const encoded = JSON.stringify(event);
    const consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Saga[]
      >`SELECT s."osId", s."filialId", s."status", s."version", s."quoteId", s."quoteVersion", o."clienteId" FROM "SagaInstance" s JOIN "OrdemDeServico" o ON o."id" = s."osId" WHERE s."id" = ${event.sagaId} FOR UPDATE OF s`;
      const saga = rows[0];
      if (
        !saga ||
        saga.osId !== event.osId ||
        saga.filialId !== event.filialId ||
        saga.clienteId !== event.data.clientId
      )
        throw new Error('Orçamento não corresponde à Saga');
      const commands = await tx.$queryRaw<
        QuoteCommand[]
      >`SELECT o."payload", op."operationId", op."status" FROM "Outbox" o JOIN "SagaOperation" op ON op."operationId" = o."payload"->>'operationId' WHERE op."sagaId" = ${event.sagaId} AND op."commandType" = 'billing.generate-quote.v1' AND o."type" = 'billing.generate-quote.v1'`;
      if (
        commands.length !== 1 ||
        !commands[0].payload?.data ||
        !Array.isArray(commands[0].payload.data.items) ||
        commands[0].payload.data.clienteId !== saga.clienteId
      )
        throw new Error('Comando de orçamento não encontrado');
      const command = commands[0];
      if (issued) {
        const amount = command.payload.data.items.reduce(
          (sum, item) => sum + item.unitPriceInCents * item.quantity,
          0,
        );
        if (
          event.operationId !== command.operationId ||
          event.data.totalInCents !== amount ||
          event.data.currency !== 'BRL' ||
          event.data.expiresAt !== command.payload.data.expiresAt
        )
          throw new Error('Orçamento diverge do diagnóstico');
      }
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches)
        throw new Error('Mensagem reutilizada com outro conteúdo');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      const previous = await tx.$queryRaw<
        Array<{ matches: boolean }>
      >`SELECT ("payload"->'data' = ${JSON.stringify(event.data)}::jsonb) AS "matches" FROM "Inbox" WHERE "consumer" = ${consumer} AND "type" = ${event.type} AND "status" = 'APPLIED' AND "payload"->>'sagaId' = ${event.sagaId}`;
      if (previous.length) {
        if (!previous.every((row) => row.matches))
          throw new Error('Fato de orçamento divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (issued) {
        if (
          saga.status !== 'ORCAMENTO_PENDENTE' ||
          !['PENDING', 'SENT'].includes(command.status)
        )
          return 'PENDING';
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'AGUARDANDO_APROVACAO', "quoteId" = ${event.data.quoteId}, "quoteVersion" = ${event.data.quoteVersion}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
        await tx.$executeRaw`UPDATE "OrdemDeServico" SET "status" = 'AGUARDANDO_APROVACAO', "quoteId" = ${event.data.quoteId}, "quoteVersion" = ${event.data.quoteVersion}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.osId}`;
        await tx.$executeRaw`UPDATE "SagaOperation" SET "status" = 'SUCCEEDED', "result" = ${encoded}::jsonb, "updatedAt" = NOW() WHERE "operationId" = ${command.operationId}`;
        await tx.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id", "osId", "status", "ocorridoEm") VALUES (${randomUUID()}, ${event.osId}, 'AGUARDANDO_APROVACAO', ${now})`;
      } else {
        if (
          saga.status !== 'AGUARDANDO_APROVACAO' ||
          saga.quoteId !== event.data.quoteId ||
          saga.quoteVersion !== event.data.quoteVersion
        )
          return 'PENDING';
        if (rejected) {
          const operationId = randomUUID();
          const messageId = randomUUID();
          const type = 'execution.cancel-work.v1';
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
            data: { reason: 'QUOTE_REJECTED' },
          };
          await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${event.sagaId}, 'CANCEL_WORK', 1, ${type}, 'PENDING', NOW())`;
          await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
          await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COMPENSANDO', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
        } else {
          const reservationId = randomUUID();
          const operationId = randomUUID();
          const messageId = randomUUID();
          const deadline = new Date(now.getTime() + 20 * 60 * 1000);
          const type = 'execution.reserve-parts.v1';
          const items = command.payload.data.items
            .filter((item) => item.itemType === 'PART')
            .map((item) => ({ sku: item.sourceId, quantity: item.quantity }));
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
              quoteId: event.data.quoteId,
              quoteVersion: event.data.quoteVersion,
              reservationId,
              deadline: deadline.toISOString(),
              items,
            },
          };
          await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${event.sagaId}, 'RESERVE_PARTS', 1, ${type}, 'PENDING', NOW())`;
          await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
          await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'RESERVA_PENDENTE', "reservationId" = ${reservationId}, "deadlineAt" = ${deadline}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
        }
      }
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
