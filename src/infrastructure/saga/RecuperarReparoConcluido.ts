import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/** Encerra somente trabalho físico concluído com fatos financeiros e de execução consistentes. */
export class RecoverCompletedRepair {
  constructor(private readonly db: PrismaClient) {}
  async execute(input: {
    sagaId: string;
    actorId: string;
    reason: string;
  }): Promise<'CONCLUIDA'> {
    if (
      !/^[a-z0-9_-]{1,128}$/i.test(input.sagaId) ||
      !/^[a-z0-9_@.-]{1,128}$/i.test(input.actorId) ||
      !/^[a-z0-9_-]{1,128}$/i.test(input.reason)
    )
      throw new Error('Dados inválidos');
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          osId: string;
          filialId: string;
          status: string;
          requiresAttention: boolean;
          executionId: string | null;
          reservationId: string | null;
          chargeId: string | null;
          osStatus: string;
        }>
      >`SELECT s."osId",s."filialId",s."status",s."requiresAttention",s."executionId",s."reservationId",s."chargeId",o."status" AS "osStatus" FROM "SagaInstance" s JOIN "OrdemDeServico" o ON o."id"=s."osId" WHERE s."id"=${input.sagaId} FOR UPDATE OF s,o`;
      const saga = rows[0];
      if (
        !saga ||
        saga.status !== 'RECONCILIACAO_NECESSARIA' ||
        !saga.requiresAttention ||
        !saga.executionId ||
        !saga.reservationId ||
        !saga.chargeId ||
        !['NA_FILA', 'EM_EXECUCAO', 'FINALIZADA'].includes(saga.osStatus)
      )
        throw new Error('Saga não permite encerramento');
      const events = await tx.$queryRaw<
        Array<{
          type: string;
          data: {
            executionId: string;
            reservationId: string;
            startedAt: string;
            completedAt?: string;
          };
        }>
      >`SELECT DISTINCT "type","payload"->'data' AS data FROM "Inbox" WHERE "consumer"='os.saga-events' AND "status"='APPLIED' AND "type" IN ('execution.work-started.v1','execution.work-completed.v1') AND "payload"->>'producer'='soat-execution-service' AND "payload"->>'sagaId'=${input.sagaId} AND "payload"->>'osId'=${saga.osId} AND "payload"->>'filialId'=${saga.filialId}`;
      const starts = events.filter(
        (event) => event.type === 'execution.work-started.v1',
      );
      const finishes = events.filter(
        (event) => event.type === 'execution.work-completed.v1',
      );
      const start = starts[0]?.data;
      const finish = finishes[0]?.data;
      const startTime = new Date(start?.startedAt ?? ''),
        finishTime = new Date(finish?.completedAt ?? '');
      if (
        starts.length !== 1 ||
        finishes.length !== 1 ||
        !start ||
        !finish ||
        start.executionId !== saga.executionId ||
        finish.executionId !== saga.executionId ||
        start.reservationId !== saga.reservationId ||
        finish.reservationId !== saga.reservationId ||
        start.startedAt !== finish.startedAt ||
        !Number.isFinite(startTime.getTime()) ||
        !Number.isFinite(finishTime.getTime()) ||
        finishTime < startTime
      )
        throw new Error('Evidências de reparo insuficientes ou conflitantes');
      const payments = await tx.$queryRaw<
        Array<{
          data: { paymentId: string; chargeId: string };
          producer: string;
          osId: string;
          filialId: string;
        }>
      >`SELECT DISTINCT "payload"->'data' AS data, "payload"->>'producer' AS producer, "payload"->>'osId' AS "osId", "payload"->>'filialId' AS "filialId" FROM "Inbox" WHERE "consumer"='os.saga-events' AND "status"='APPLIED' AND "type"='billing.payment-confirmed.v1' AND "payload"->>'sagaId'=${input.sagaId}`;
      const payment = payments[0];
      if (
        payments.length !== 1 ||
        payment.producer !== 'soat-billing-service' ||
        payment.osId !== saga.osId ||
        payment.filialId !== saga.filialId ||
        !payment.data.paymentId ||
        payment.data.chargeId !== saga.chargeId
      )
        throw new Error('Pagamento exige análise');
      const proof = await tx.$queryRaw<
        Array<{ queue: bigint; conflicts: bigint }>
      >`SELECT (SELECT count(*) FROM "SagaOperation" WHERE "sagaId"=${input.sagaId} AND "commandType"='execution.enqueue-work.v1' AND "status"='SUCCEEDED' AND "result"->'data'->>'executionId'=${saga.executionId} AND "result"->'data'->>'reservationId'=${saga.reservationId} AND "result"->'data'->>'chargeId'=${saga.chargeId} AND "result"->'data'->>'paymentId'=${payment.data.paymentId}) AS queue, (SELECT count(*) FROM "SagaOperation" WHERE "sagaId"=${input.sagaId} AND "commandType" IN ('execution.cancel-work.v1','billing.refund-payment.v1','execution.release-parts.v1')) AS conflicts`;
      if (proof[0].queue !== 1n || proof[0].conflicts !== 0n)
        throw new Error('Fila ou compensação exige análise');
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status"='CONCLUIDA',"requiresAttention"=false,"lastError"=NULL,"deadlineAt"=NULL,"version"="version"+1,"updatedAt"=NOW() WHERE "id"=${input.sagaId}`;
      await tx.$executeRaw`UPDATE "OrdemDeServico" SET "status"='FINALIZADA',"executionId"=${saga.executionId},"dataInicioExecucao"=${startTime},"dataFinalizacao"=${finishTime},"version"="version"+1,"updatedAt"=NOW() WHERE "id"=${saga.osId}`;
      await tx.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id","osId","status","ocorridoEm") SELECT ${randomUUID()},${saga.osId},'EM_EXECUCAO',${startTime} WHERE NOT EXISTS (SELECT 1 FROM "HistoricoStatusOS" WHERE "osId"=${saga.osId} AND "status"='EM_EXECUCAO')`;
      await tx.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id","osId","status","ocorridoEm") SELECT ${randomUUID()},${saga.osId},'FINALIZADA',${finishTime} WHERE NOT EXISTS (SELECT 1 FROM "HistoricoStatusOS" WHERE "osId"=${saga.osId} AND "status"='FINALIZADA')`;
      await tx.$executeRaw`INSERT INTO "SagaRecoveryAudit" ("id","sagaId","messageId","actorId","reason") VALUES (${randomUUID()},${input.sagaId},${saga.executionId},${input.actorId},${input.reason})`;
      return 'CONCLUIDA' as const;
    });
  }
}
