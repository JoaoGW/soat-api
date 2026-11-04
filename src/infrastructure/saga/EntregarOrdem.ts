import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/** A entrega depende da conclusão e da evidência financeira já aplicada à Saga. */
export class DeliverOrder {
  constructor(private readonly db: PrismaClient) {}

  async execute(
    osId: string,
    now = new Date(),
  ): Promise<'ENTREGUE' | 'JA_ENTREGUE'> {
    if (!/^[a-z0-9_-]{1,128}$/i.test(osId) || !Number.isFinite(now.getTime()))
      throw new Error('Entrega inválida');
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          requiresAttention: boolean;
          chargeId: string | null;
          osStatus: string;
        }>
      >`
        SELECT s."id", s."status", s."requiresAttention", s."chargeId", o."status" AS "osStatus"
        FROM "SagaInstance" s JOIN "OrdemDeServico" o ON o."id" = s."osId"
        WHERE s."osId" = ${osId} FOR UPDATE OF s, o`;
      const saga = rows[0];
      if (rows.length !== 1 || !saga)
        throw new Error('Ordem ou Saga inexistente');
      if (saga.osStatus === 'ENTREGUE') return 'JA_ENTREGUE';
      if (
        saga.status !== 'CONCLUIDA' ||
        saga.osStatus !== 'FINALIZADA' ||
        saga.requiresAttention ||
        !saga.chargeId
      )
        throw new Error('Ordem não permite entrega');
      const payments = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS "count" FROM "Inbox" WHERE "consumer" = 'os.saga-events'
          AND "status" = 'APPLIED' AND "type" = 'billing.payment-confirmed.v1'
          AND "payload"->>'sagaId' = ${saga.id} AND "payload"->>'osId' = ${osId}
          AND "payload"->'data'->>'chargeId' = ${saga.chargeId}`;
      const refunds = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS "count" FROM "SagaOperation" WHERE "sagaId" = ${saga.id}
          AND "commandType" = 'billing.refund-payment.v1'`;
      if (payments[0].count < 1n || refunds[0].count !== 0n)
        throw new Error('Situação financeira não permite entrega');
      await tx.$executeRaw`UPDATE "OrdemDeServico" SET "status" = 'ENTREGUE', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${osId}`;
      await tx.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id", "osId", "status", "ocorridoEm") VALUES (${randomUUID()}, ${osId}, 'ENTREGUE', ${now})`;
      return 'ENTREGUE';
    });
  }
}
