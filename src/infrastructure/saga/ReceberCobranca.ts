import { PrismaClient } from '@prisma/client';

type ChargeEvent = {
  messageId: string;
  type: 'billing.charge-created.v1' | 'billing.charge-failed.v1';
  producer: 'soat-billing-service';
  operationId: string;
  sagaId: string;
  osId: string;
  filialId: string;
  data: {
    quoteId: string;
    quoteVersion: number;
    chargeId: string;
    reservationId: string;
    clientId?: string;
    totalInCents?: number;
    currency?: string;
    providerOrderId?: string;
    externalReference?: string;
    expiresAt?: string;
    reasonCode?: string;
  };
  [key: string]: unknown;
};
type SagaRow = {
  id: string;
  osId: string;
  filialId: string;
  status: string;
  quoteId: string | null;
  quoteVersion: number | null;
  chargeId: string | null;
};
type OperationRow = {
  commandType: string;
  status: string;
  sameResult: boolean | null;
};
type StoredCommand = { payload: { data?: Record<string, unknown> } };

/** Requires prior JSON Schema and transport identity validation. Does not execute compensation. */
export class ReceiveChargeEvent {
  constructor(private readonly db: PrismaClient) {}

  async execute(event: ChargeEvent): Promise<'APPLIED' | 'PENDING'> {
    if (
      !event ||
      event.producer !== 'soat-billing-service' ||
      !['billing.charge-created.v1', 'billing.charge-failed.v1'].includes(
        event.type,
      ) ||
      ![
        event.messageId,
        event.operationId,
        event.sagaId,
        event.osId,
        event.filialId,
        event.data?.quoteId,
        event.data?.chargeId,
        event.data?.reservationId,
      ].every((value) => typeof value === 'string' && value.length > 0) ||
      !Number.isSafeInteger(event.data.quoteVersion) ||
      event.data.quoteVersion < 1
    )
      throw new Error('Evento de cobrança inválido');
    if (
      event.type === 'billing.charge-created.v1' &&
      (!event.data.providerOrderId ||
        !event.data.expiresAt ||
        !Number.isFinite(Date.parse(event.data.expiresAt)))
    )
      throw new Error('Evento de cobrança inválido');
    if (
      event.type === 'billing.charge-failed.v1' &&
      event.data.reasonCode !== 'EXPIRED'
    )
      throw new Error('Evento de cobrança inválido');
    const encoded = JSON.stringify(event);
    return this.db.$transaction(async (tx) => {
      const sagas = await tx.$queryRaw<
        SagaRow[]
      >`SELECT "id", "osId", "filialId", "status", "quoteId", "quoteVersion", "chargeId" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
      const saga = sagas[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Saga não corresponde ao evento');
      const operations = await tx.$queryRaw<
        OperationRow[]
      >`SELECT "commandType", "status", ("result"->'data' = ${JSON.stringify(event.data)}::jsonb) AS "sameResult" FROM "SagaOperation" WHERE "operationId" = ${event.operationId} AND "sagaId" = ${event.sagaId}`;
      const operation = operations[0];
      if (!operation || operation.commandType !== 'billing.create-charge.v1')
        throw new Error('Operação não corresponde ao evento');
      const commands = await tx.$queryRaw<
        StoredCommand[]
      >`SELECT "payload" FROM "Outbox" WHERE "type" = 'billing.create-charge.v1' AND "payload"->>'operationId' = ${event.operationId} AND "payload"->>'sagaId' = ${event.sagaId}`;
      const command = commands[0]?.payload?.data;
      if (
        !command ||
        command.quoteId !== event.data.quoteId ||
        command.quoteVersion !== event.data.quoteVersion ||
        command.chargeId !== event.data.chargeId ||
        command.reservationId !== event.data.reservationId ||
        (event.type === 'billing.charge-created.v1' &&
          (command.clientId !== event.data.clientId ||
            command.totalInCents !== event.data.totalInCents ||
            command.currency !== event.data.currency ||
            typeof command.expiresAt !== 'string' ||
            Date.parse(command.expiresAt) !==
              Date.parse(event.data.expiresAt as string) ||
            event.data.externalReference !== event.data.chargeId))
      )
        throw new Error('Evento diverge do comando');
      const consumer = 'os.saga-events';
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const messages = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!messages[0]?.matches)
        throw new Error('Mensagem reutilizada com outro conteúdo');
      if (messages[0].status === 'APPLIED') return 'APPLIED';
      if (
        event.type === 'billing.charge-created.v1' &&
        operation.status === 'SUCCEEDED' &&
        operation.sameResult &&
        saga.chargeId === event.data.chargeId
      ) {
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        event.type !== 'billing.charge-created.v1' ||
        saga.status !== 'COBRANCA_PENDENTE' ||
        saga.quoteId !== event.data.quoteId ||
        saga.quoteVersion !== event.data.quoteVersion ||
        !['PENDING', 'SENT'].includes(operation.status)
      )
        return 'PENDING';
      const deadline = new Date(event.data.expiresAt as string);
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'AGUARDANDO_PAGAMENTO', "chargeId" = ${event.data.chargeId}, "deadlineAt" = ${deadline}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      await tx.$executeRaw`UPDATE "SagaOperation" SET "status" = 'SUCCEEDED', "result" = ${encoded}::jsonb, "updatedAt" = NOW() WHERE "operationId" = ${event.operationId}`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
