import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

export type RepairEvent = {
  messageId: string;
  operationId: string;
  sagaId: string;
  osId: string;
  filialId: string;
  type: 'execution.work-started.v1' | 'execution.work-completed.v1';
  producer: 'soat-execution-service';
  data: {
    executionId: string;
    reservationId: string;
    startedAt: string;
    completedAt?: string;
  };
};
type Saga = {
  osId: string;
  filialId: string;
  status: string;
  executionId: string | null;
  reservationId: string | null;
};

/** O transporte deve validar schema e origem antes de chamar este serviço. */
export class ReceiveRepairEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(event: RepairEvent): Promise<'APPLIED' | 'PENDING'> {
    const start = event?.type === 'execution.work-started.v1';
    const finish = event?.type === 'execution.work-completed.v1';
    const startedAt = new Date(event?.data?.startedAt ?? '');
    const completedAt = finish
      ? new Date(event?.data?.completedAt ?? '')
      : null;
    if (
      (!start && !finish) ||
      event?.producer !== 'soat-execution-service' ||
      ![
        event?.messageId,
        event?.operationId,
        event?.sagaId,
        event?.osId,
        event?.filialId,
        event?.data?.executionId,
        event?.data?.reservationId,
      ].every((id) => typeof id === 'string' && id.length > 0) ||
      !Number.isFinite(startedAt.getTime()) ||
      (finish &&
        (!completedAt ||
          !Number.isFinite(completedAt.getTime()) ||
          completedAt < startedAt))
    )
      throw new Error('Evento de reparo inválido');
    const encoded = JSON.stringify(event);
    const consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Saga[]
      >`SELECT "osId", "filialId", "status", "executionId", "reservationId" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
      const saga = rows[0];
      if (
        !saga ||
        saga.osId !== event.osId ||
        saga.filialId !== event.filialId ||
        saga.executionId !== event.data.executionId ||
        saga.reservationId !== event.data.reservationId
      )
        throw new Error('Reparo não corresponde à Saga');
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
        if (!previous.every((item) => item.matches))
          throw new Error('Fato de reparo divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        ['COMPENSANDO', 'COMPENSADA', 'RECONCILIACAO_NECESSARIA'].includes(
          saga.status,
        )
      ) {
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        (start && saga.status !== 'NA_FILA') ||
        (finish && saga.status !== 'EM_EXECUCAO')
      )
        return 'PENDING';
      if (finish) {
        const starts = await tx.$queryRaw<
          Array<{ matches: boolean }>
        >`SELECT ("payload"->'data'->>'startedAt' = ${event.data.startedAt}) AS "matches" FROM "Inbox" WHERE "consumer" = ${consumer} AND "type" = 'execution.work-started.v1' AND "status" = 'APPLIED' AND "payload"->>'sagaId' = ${event.sagaId}`;
        if (!starts.length || !starts.every((row) => row.matches))
          throw new Error('Conclusão diverge do início');
      }
      const next = start ? 'EM_EXECUCAO' : 'CONCLUIDA';
      const osStatus = start ? 'EM_EXECUCAO' : 'FINALIZADA';
      const when = start ? startedAt : completedAt!;
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = ${next}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      if (start)
        await tx.$executeRaw`UPDATE "OrdemDeServico" SET "status" = ${osStatus}, "executionId" = ${event.data.executionId}, "dataInicioExecucao" = ${when}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.osId}`;
      else
        await tx.$executeRaw`UPDATE "OrdemDeServico" SET "status" = ${osStatus}, "dataFinalizacao" = ${when}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.osId}`;
      await tx.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id", "osId", "status", "ocorridoEm") VALUES (${randomUUID()}, ${event.osId}, ${osStatus}, ${when})`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
