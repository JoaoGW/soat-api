import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { captureTrace } from '../observability/TraceContext';

/** Fences execution first; only the authenticated cancellation can authorize a refund. */
export class RecoverLatePayment {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    input: { sagaId: string; actorId: string; reason: string },
    now = new Date(),
  ): Promise<'STARTED'> {
    if (
      ![input.sagaId, input.reason].every(
        (value) =>
          typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value),
      ) ||
      typeof input.actorId !== 'string' ||
      !/^[a-z0-9_@.-]{1,128}$/i.test(input.actorId) ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Dados inválidos');
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          osId: string;
          filialId: string;
          status: string;
          requiresAttention: boolean;
          version: number;
          quoteId: string | null;
          quoteVersion: number | null;
          reservationId: string | null;
          chargeId: string | null;
          executionId: string | null;
        }>
      >`SELECT "id","osId","filialId","status","requiresAttention","version","quoteId","quoteVersion","reservationId","chargeId","executionId" FROM "SagaInstance" WHERE "id"=${input.sagaId} FOR UPDATE`;
      const saga = rows[0];
      if (
        !saga ||
        saga.status !== 'RECONCILIACAO_NECESSARIA' ||
        !saga.requiresAttention ||
        !saga.quoteId ||
        !saga.quoteVersion ||
        !saga.reservationId ||
        !saga.chargeId
      )
        throw new Error('Saga sem evidências suficientes');
      const paid = await tx.$queryRaw<
        Array<{
          payment: {
            paymentId?: string;
            chargeId?: string;
            quoteId?: string;
            quoteVersion?: number;
            providerOrderId?: string;
            amountInCents?: number;
            currency?: string;
          };
          command: {
            data?: {
              chargeId?: string;
              quoteId?: string;
              quoteVersion?: number;
              reservationId?: string;
              totalInCents?: number;
              currency?: string;
            };
          };
          providerOrderId: string;
        }>
      >`
        SELECT DISTINCT i."payload"->'data' AS payment, o."payload" AS command, op."result"->'data'->>'providerOrderId' AS "providerOrderId"
        FROM "Inbox" i JOIN "SagaOperation" op ON op."operationId"=i."operationId" AND op."sagaId"=${saga.id} AND op."commandType"='billing.create-charge.v1' AND op."status"='SUCCEEDED'
        JOIN "Outbox" o ON o."payload"->>'operationId'=op."operationId" AND o."type"=op."commandType"
        WHERE i."consumer"='os.saga-events' AND i."status"='APPLIED' AND i."type"='billing.payment-confirmed.v1' AND i."payload"->>'producer'='soat-billing-service' AND i."payload"->>'sagaId'=${saga.id} AND i."payload"->>'osId'=${saga.osId} AND i."payload"->>'filialId'=${saga.filialId}`;
      const p = paid[0]?.payment;
      const c = paid[0]?.command?.data;
      if (
        paid.length !== 1 ||
        !p?.paymentId ||
        !p.providerOrderId ||
        p.providerOrderId !== paid[0].providerOrderId ||
        p.chargeId !== saga.chargeId ||
        p.quoteId !== saga.quoteId ||
        p.quoteVersion !== saga.quoteVersion ||
        c?.chargeId !== saga.chargeId ||
        c.quoteId !== saga.quoteId ||
        c.quoteVersion !== saga.quoteVersion ||
        c.reservationId !== saga.reservationId ||
        c.totalInCents !== p.amountInCents ||
        c.currency !== 'BRL' ||
        p.currency !== 'BRL'
      )
        throw new Error('Pagamento não corresponde à Saga');
      const proof = await tx.$queryRaw<
        Array<{ reservations: bigint; conflicts: bigint; payments: bigint }>
      >`SELECT (SELECT count(*) FROM "SagaOperation" WHERE "sagaId"=${saga.id} AND "commandType"='execution.reserve-parts.v1' AND "status"='SUCCEEDED' AND "result"->'data'->>'reservationId'=${saga.reservationId}) AS reservations, (SELECT count(*) FROM "SagaOperation" WHERE "sagaId"=${saga.id} AND "commandType" IN ('execution.cancel-work.v1','billing.refund-payment.v1','execution.release-parts.v1')) AS conflicts, (SELECT count(DISTINCT "payload"->'data') FROM "Inbox" WHERE "consumer"='os.saga-events' AND "status"='APPLIED' AND "type"='billing.payment-confirmed.v1' AND "payload"->>'sagaId'=${saga.id}) AS payments`;
      if (
        proof[0].reservations !== 1n ||
        proof[0].conflicts !== 0n ||
        proof[0].payments !== 1n
      )
        throw new Error('Reserva, pagamento ou compensação exige análise');
      const operationId = randomUUID(),
        messageId = randomUUID(),
        type = 'execution.cancel-work.v1';
      const payload = {
        messageId,
        type,
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        producer: 'soat-os-service',
        aggregateType: 'saga',
        aggregateId: saga.id,
        aggregateVersion: saga.version + 1,
        osId: saga.osId,
        sagaId: saga.id,
        filialId: saga.filialId,
        correlationId: saga.id,
        causationId: operationId,
        operationId,
        ...captureTrace(),
        data: {
          reason: input.reason,
          ...(saga.executionId ? { executionId: saga.executionId } : {}),
        },
      };
      await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId","sagaId","step","businessAttempt","commandType","status","updatedAt") VALUES (${operationId},${saga.id},'CANCEL_WORK',1,${type},'PENDING',NOW())`;
      await tx.$executeRaw`INSERT INTO "Outbox" ("messageId","type","payload") VALUES (${messageId},${type},${JSON.stringify(payload)}::jsonb)`;
      await tx.$executeRaw`INSERT INTO "SagaRecoveryAudit" ("id","sagaId","messageId","actorId","reason") VALUES (${randomUUID()},${saga.id},${messageId},${input.actorId},${input.reason})`;
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status"='COMPENSANDO',"requiresAttention"=false,"lastError"=NULL,"deadlineAt"=NULL,"version"="version"+1,"updatedAt"=NOW() WHERE "id"=${saga.id}`;
      return 'STARTED' as const;
    });
  }
}
