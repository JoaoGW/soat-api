import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

type Part = { sku: string; quantity: number };
export type ReservationEvent = {
  messageId: string;
  operationId: string;
  sagaId: string;
  osId: string;
  filialId: string;
  correlationId: string;
  type: 'execution.parts-reserved.v1';
  producer: 'soat-execution-service';
  data: {
    quoteId: string;
    quoteVersion: number;
    reservationId: string;
    deadline: string;
    items: Part[];
  };
};
type Saga = {
  osId: string;
  filialId: string;
  status: string;
  version: number;
  quoteId: string | null;
  quoteVersion: number | null;
  reservationId: string | null;
  clienteId: string;
};
type Command = {
  status: string;
  payload: {
    data: {
      quoteId: string;
      quoteVersion: number;
      reservationId: string;
      deadline: string;
      items: Part[];
    };
  };
};
const normalize = (parts: Part[]) =>
  JSON.stringify([...parts].sort((a, b) => a.sku.localeCompare(b.sku)));
/** Somente eventos de Execution autenticados e com schema validado devem entrar. */
export class ReceiveReservationEvent {
  constructor(
    private readonly db: PrismaClient,
    private readonly externalPosId: string | undefined,
  ) {}
  async execute(
    event: ReservationEvent,
    now = new Date(),
  ): Promise<'APPLIED' | 'PENDING'> {
    const d = event?.data;
    if (
      event?.type !== 'execution.parts-reserved.v1' ||
      event?.producer !== 'soat-execution-service' ||
      ![
        event.messageId,
        event.operationId,
        event.sagaId,
        event.osId,
        event.filialId,
        event.correlationId,
        d?.quoteId,
        d?.reservationId,
      ].every((id) => typeof id === 'string' && id.length > 0) ||
      !Number.isSafeInteger(d.quoteVersion) ||
      d.quoteVersion < 1 ||
      !Array.isArray(d.items) ||
      d.items.length > 20 ||
      d.items.some(
        (part) =>
          typeof part?.sku !== 'string' ||
          !part.sku ||
          !Number.isSafeInteger(part.quantity) ||
          part.quantity < 1,
      ) ||
      !Number.isFinite(Date.parse(d.deadline)) ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Reserva inválida');
    const encoded = JSON.stringify(event);
    const consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Saga[]
      >`SELECT s."osId", s."filialId", s."status", s."version", s."quoteId", s."quoteVersion", s."reservationId", o."clienteId" FROM "SagaInstance" s JOIN "OrdemDeServico" o ON o."id" = s."osId" WHERE s."id" = ${event.sagaId} FOR UPDATE OF s`;
      const saga = rows[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Reserva não corresponde à Saga');
      const commands = await tx.$queryRaw<
        Command[]
      >`SELECT op."status", o."payload" FROM "SagaOperation" op JOIN "Outbox" o ON o."payload"->>'operationId' = op."operationId" WHERE op."operationId" = ${event.operationId} AND op."sagaId" = ${event.sagaId} AND op."commandType" = 'execution.reserve-parts.v1' AND o."type" = 'execution.reserve-parts.v1'`;
      const command = commands[0];
      const data = command?.payload?.data;
      if (
        commands.length !== 1 ||
        !data ||
        data.quoteId !== d.quoteId ||
        data.quoteVersion !== d.quoteVersion ||
        data.reservationId !== d.reservationId ||
        data.deadline !== d.deadline ||
        !Array.isArray(data.items) ||
        normalize(data.items) !== normalize(d.items)
      )
        throw new Error('Reserva diverge do comando');
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches)
        throw new Error('Mensagem reutilizada com outro conteúdo');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      if (command.status === 'SUCCEEDED') {
        const previous = await tx.$queryRaw<
          Array<{ matches: boolean }>
        >`SELECT ("result"->'data' = ${JSON.stringify(d)}::jsonb) AS "matches" FROM "SagaOperation" WHERE "operationId" = ${event.operationId}`;
        if (!previous[0]?.matches) throw new Error('Reserva divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        saga.status !== 'RESERVA_PENDENTE' ||
        saga.quoteId !== d.quoteId ||
        saga.quoteVersion !== d.quoteVersion ||
        saga.reservationId !== d.reservationId ||
        !['PENDING', 'SENT'].includes(command.status)
      )
        return 'PENDING';
      if (Date.parse(d.deadline) <= now.getTime()) {
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      } else {
        if (
          !this.externalPosId ||
          !/^[a-z0-9_-]{1,64}$/i.test(this.externalPosId)
        )
          return 'PENDING';
        const quotes = await tx.$queryRaw<
          Array<{
            data: { clientId: string; totalInCents: number; currency: string };
          }>
        >`SELECT "result"->'data' AS data FROM "SagaOperation" WHERE "sagaId" = ${event.sagaId} AND "commandType" = 'billing.generate-quote.v1' AND "status" = 'SUCCEEDED'`;
        const quote = quotes[0]?.data;
        if (
          quotes.length !== 1 ||
          !quote ||
          quote.clientId !== saga.clienteId ||
          !Number.isSafeInteger(quote.totalInCents) ||
          quote.totalInCents < 1 ||
          quote.currency !== 'BRL'
        )
          throw new Error('Orçamento não permite cobrança');
        const chargeId = randomUUID();
        const operationId = randomUUID();
        const messageId = randomUUID();
        const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
        const type = 'billing.create-charge.v1';
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
            quoteId: d.quoteId,
            quoteVersion: d.quoteVersion,
            chargeId,
            clientId: saga.clienteId,
            totalInCents: quote.totalInCents,
            currency: 'BRL',
            externalPosId: this.externalPosId,
            expiresAt: expiresAt.toISOString(),
            reservationId: d.reservationId,
          },
        };
        await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${event.sagaId}, 'CREATE_CHARGE', 1, ${type}, 'PENDING', NOW())`;
        await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COBRANCA_PENDENTE', "deadlineAt" = ${expiresAt}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      }
      await tx.$executeRaw`UPDATE "SagaOperation" SET "status" = 'SUCCEEDED', "result" = ${encoded}::jsonb, "updatedAt" = NOW() WHERE "operationId" = ${event.operationId}`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
