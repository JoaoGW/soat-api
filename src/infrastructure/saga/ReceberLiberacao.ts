import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
export type ReleaseEvent = {
  messageId: string;
  operationId: string;
  osId: string;
  sagaId: string;
  filialId: string;
  type: 'execution.parts-released.v1';
  producer: 'soat-execution-service';
  data: {
    reservationId: string;
    cancelOperationId: string;
    reason: string;
    outcome: 'RELEASED' | 'NO_RESERVATION';
  };
};
export class ReceiveReleaseEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    event: ReleaseEvent,
    now = new Date(),
  ): Promise<'APPLIED' | 'PENDING'> {
    const d = event?.data;
    if (
      event?.type !== 'execution.parts-released.v1' ||
      event?.producer !== 'soat-execution-service' ||
      ![
        event.messageId,
        event.operationId,
        event.osId,
        event.sagaId,
        event.filialId,
        d?.reservationId,
        d?.cancelOperationId,
        d?.reason,
      ].every((id) => typeof id === 'string' && id.length > 0) ||
      !['RELEASED', 'NO_RESERVATION'].includes(d.outcome) ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Liberação inválida');
    const encoded = JSON.stringify(event);
    const consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          osId: string;
          filialId: string;
          status: string;
          reservationId: string | null;
        }>
      >`SELECT "osId", "filialId", "status", "reservationId" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
      const saga = rows[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Saga não corresponde à liberação');
      const commands = await tx.$queryRaw<
        Array<{
          status: string;
          payload: {
            data: {
              reservationId: string;
              cancelOperationId: string;
              reason: string;
            };
          };
          sameResult: boolean | null;
        }>
      >`SELECT op."status", o."payload", (op."result"->'data' = ${JSON.stringify(d)}::jsonb) AS "sameResult" FROM "SagaOperation" op JOIN "Outbox" o ON o."payload"->>'operationId' = op."operationId" WHERE op."operationId" = ${event.operationId} AND op."sagaId" = ${event.sagaId} AND op."commandType" = 'execution.release-parts.v1' AND o."type" = 'execution.release-parts.v1'`;
      const command = commands[0];
      if (
        commands.length !== 1 ||
        command.payload?.data?.reservationId !== d.reservationId ||
        command.payload.data.cancelOperationId !== d.cancelOperationId ||
        command.payload.data.reason !== d.reason
      )
        throw new Error('Liberação diverge do comando');
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches) throw new Error('Mensagem reutilizada');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      if (command.status === 'SUCCEEDED') {
        if (!command.sameResult) throw new Error('Liberação divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        saga.status !== 'LIBERACAO_PENDENTE' ||
        saga.reservationId !== d.reservationId ||
        !['PENDING', 'SENT'].includes(command.status)
      )
        return 'PENDING';
      if (d.outcome === 'NO_RESERVATION')
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      else {
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
