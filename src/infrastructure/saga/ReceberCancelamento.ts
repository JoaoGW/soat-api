import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
export type CancellationEvent = {
  messageId: string;
  operationId: string;
  osId: string;
  sagaId: string;
  filialId: string;
  type: 'execution.work-cancelled.v1';
  producer: 'soat-execution-service';
  data: {
    outcome: 'CANCELLED' | 'ALREADY_STARTED';
    reason: string;
    executionId?: string;
  };
};
type Saga = {
  osId: string;
  filialId: string;
  status: string;
  reservationId: string | null;
  chargeId: string | null;
  executionId: string | null;
};
type Command = {
  status: string;
  payload: { data: { reason: string; executionId?: string } };
  sameResult: boolean | null;
};
export class ReceiveCancellationEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    event: CancellationEvent,
    now = new Date(),
  ): Promise<'APPLIED' | 'PENDING'> {
    if (
      event?.type !== 'execution.work-cancelled.v1' ||
      event?.producer !== 'soat-execution-service' ||
      ![
        event.messageId,
        event.operationId,
        event.osId,
        event.sagaId,
        event.filialId,
        event.data?.reason,
      ].every((id) => typeof id === 'string' && id.length > 0) ||
      !['CANCELLED', 'ALREADY_STARTED'].includes(event.data.outcome) ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Cancelamento inválido');
    const encoded = JSON.stringify(event);
    const consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Saga[]
      >`SELECT "osId", "filialId", "status", "reservationId", "chargeId", "executionId" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
      const saga = rows[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Cancelamento não corresponde à Saga');
      const commands = await tx.$queryRaw<
        Command[]
      >`SELECT op."status", o."payload", (op."result"->'data' = ${JSON.stringify(event.data)}::jsonb) AS "sameResult" FROM "SagaOperation" op JOIN "Outbox" o ON o."payload"->>'operationId' = op."operationId" WHERE op."operationId" = ${event.operationId} AND op."sagaId" = ${event.sagaId} AND op."commandType" = 'execution.cancel-work.v1' AND o."type" = 'execution.cancel-work.v1'`;
      const command = commands[0];
      if (
        commands.length !== 1 ||
        command.payload?.data?.reason !== event.data.reason ||
        (command.payload.data.executionId &&
          command.payload.data.executionId !== event.data.executionId)
      )
        throw new Error('Cancelamento diverge do comando');
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches)
        throw new Error('Mensagem reutilizada com outro conteúdo');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      if (command.status === 'SUCCEEDED') {
        if (!command.sameResult) throw new Error('Cancelamento divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        saga.status !== 'COMPENSANDO' ||
        !['PENDING', 'SENT'].includes(command.status)
      )
        return 'PENDING';
      if (
        event.data.outcome === 'ALREADY_STARTED' ||
        saga.reservationId ||
        saga.chargeId ||
        saga.executionId
      ) {
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      } else {
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COMPENSADA', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
        await tx.$executeRaw`UPDATE "OrdemDeServico" SET "status" = 'CANCELADA', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.osId}`;
        await tx.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id", "osId", "status", "ocorridoEm") VALUES (${randomUUID()}, ${event.osId}, 'CANCELADA', ${now})`;
      }
      await tx.$executeRaw`UPDATE "SagaOperation" SET "status" = 'SUCCEEDED', "result" = ${encoded}::jsonb, "updatedAt" = NOW() WHERE "operationId" = ${event.operationId}`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
