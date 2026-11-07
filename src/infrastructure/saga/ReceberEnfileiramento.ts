import { PrismaClient } from '@prisma/client';

export type WorkEnqueuedEvent = {
  messageId: string;
  type: 'execution.work-enqueued.v1';
  producer: 'soat-execution-service';
  operationId: string;
  sagaId: string;
  osId: string;
  filialId: string;
  data: {
    executionId: string;
    reservationId: string;
    quoteId: string;
    quoteVersion: number;
    chargeId: string;
    paymentId: string;
  };
  [key: string]: unknown;
};
type Saga = {
  osId: string;
  filialId: string;
  status: string;
  executionId: string | null;
  reservationId: string | null;
  quoteId: string | null;
  quoteVersion: number | null;
  chargeId: string | null;
};
type Operation = { status: string; sameResult: boolean | null };
type Command = { payload: { data?: Record<string, unknown> } };

/** Schema and producer identity must be validated by the transport boundary. */
export class ReceiveWorkEnqueuedEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(event: WorkEnqueuedEvent): Promise<'APPLIED' | 'PENDING'> {
    if (
      !event ||
      event.type !== 'execution.work-enqueued.v1' ||
      event.producer !== 'soat-execution-service' ||
      ![
        event.messageId,
        event.operationId,
        event.sagaId,
        event.osId,
        event.filialId,
        event.data?.executionId,
        event.data?.reservationId,
        event.data?.quoteId,
        event.data?.chargeId,
        event.data?.paymentId,
      ].every((value) => typeof value === 'string' && value.length > 0) ||
      !Number.isSafeInteger(event.data.quoteVersion) ||
      event.data.quoteVersion < 1
    )
      throw new Error('Evento de fila inválido');
    const encoded = JSON.stringify(event);
    return this.db.$transaction(async (tx) => {
      const sagas = await tx.$queryRaw<
        Saga[]
      >`SELECT "osId", "filialId", "status", "executionId", "reservationId", "quoteId", "quoteVersion", "chargeId" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
      const saga = sagas[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Saga não corresponde à execução');
      const operations = await tx.$queryRaw<
        Operation[]
      >`SELECT "status", ("result"->'data' = ${JSON.stringify(event.data)}::jsonb) AS "sameResult" FROM "SagaOperation" WHERE "operationId" = ${event.operationId} AND "sagaId" = ${event.sagaId} AND "commandType" = 'execution.enqueue-work.v1'`;
      const operation = operations[0];
      if (!operation) throw new Error('Operação não corresponde à execução');
      const commands = await tx.$queryRaw<
        Command[]
      >`SELECT "payload" FROM "Outbox" WHERE "type" = 'execution.enqueue-work.v1' AND "payload"->>'operationId' = ${event.operationId} AND "payload"->>'sagaId' = ${event.sagaId}`;
      const data = commands[0]?.payload?.data;
      if (
        !data ||
        data.executionId !== event.data.executionId ||
        data.reservationId !== event.data.reservationId ||
        data.quoteId !== event.data.quoteId ||
        data.quoteVersion !== event.data.quoteVersion ||
        data.chargeId !== event.data.chargeId ||
        data.paymentId !== event.data.paymentId
      )
        throw new Error('Evento diverge do comando');
      const consumer = 'os.saga-events';
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches)
        throw new Error('Mensagem reutilizada com outro conteúdo');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      if (
        operation.status === 'SUCCEEDED' &&
        operation.sameResult &&
        saga.executionId === event.data.executionId
      ) {
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        saga.status !== 'FILA_PENDENTE' ||
        saga.executionId !== event.data.executionId ||
        saga.reservationId !== event.data.reservationId ||
        saga.quoteId !== event.data.quoteId ||
        saga.quoteVersion !== event.data.quoteVersion ||
        saga.chargeId !== event.data.chargeId ||
        !['PENDING', 'SENT'].includes(operation.status)
      )
        return 'PENDING';
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'NA_FILA', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      await tx.$executeRaw`UPDATE "SagaOperation" SET "status" = 'SUCCEEDED', "result" = ${encoded}::jsonb, "updatedAt" = NOW() WHERE "operationId" = ${event.operationId}`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
