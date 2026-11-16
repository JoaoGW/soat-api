import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { forwardTrace } from '../observability/TraceContext';

export type WorkFailedEvent = {
  messageId: string;
  operationId: string;
  sagaId: string;
  osId: string;
  filialId: string;
  correlationId?: string;
  type: 'execution.work-failed.v1';
  producer: 'soat-execution-service';
  data: {
    executionId: string;
    reservationId: string;
    startedAt: string;
    failedAt: string;
    reason: string;
  };
};
type Saga = {
  osId: string;
  filialId: string;
  status: string;
  version: number;
  executionId: string | null;
  reservationId: string | null;
  chargeId: string | null;
  lastError: string | null;
};

/**
 * Falha declarada por Execution depois do início do reparo. As peças já foram
 * consumidas no início, então a compensação é somente financeira: estorno do
 * pagamento (evidência = este evento) e, ao confirmar o estorno, OS CANCELADA.
 * O transporte valida schema e assinatura antes de chamar este serviço.
 */
export class ReceiveWorkFailedEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    event: WorkFailedEvent,
    now = new Date(),
  ): Promise<'APPLIED' | 'PENDING'> {
    const d = event?.data;
    const startedAt = new Date(d?.startedAt ?? '');
    const failedAt = new Date(d?.failedAt ?? '');
    if (
      event?.type !== 'execution.work-failed.v1' ||
      event?.producer !== 'soat-execution-service' ||
      ![
        event.messageId,
        event.operationId,
        event.sagaId,
        event.osId,
        event.filialId,
        d?.executionId,
        d?.reservationId,
      ].every((id) => typeof id === 'string' && id.length > 0) ||
      typeof d.reason !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(d.reason) ||
      !Number.isFinite(startedAt.getTime()) ||
      !Number.isFinite(failedAt.getTime()) ||
      failedAt < startedAt ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Falha de execução inválida');
    const encoded = JSON.stringify(event);
    const consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Saga[]
      >`SELECT "osId", "filialId", "status", "version", "executionId", "reservationId", "chargeId", "lastError" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
      const saga = rows[0];
      if (
        !saga ||
        saga.osId !== event.osId ||
        saga.filialId !== event.filialId ||
        saga.executionId !== d.executionId ||
        saga.reservationId !== d.reservationId
      )
        throw new Error('Falha de execução não corresponde à Saga');
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches)
        throw new Error('Mensagem reutilizada com outro conteúdo');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      const previous = await tx.$queryRaw<
        Array<{ matches: boolean }>
      >`SELECT ("payload"->'data' = ${JSON.stringify(d)}::jsonb) AS "matches" FROM "Inbox" WHERE "consumer" = ${consumer} AND "type" = ${event.type} AND "status" = 'APPLIED' AND "payload"->>'sagaId' = ${event.sagaId}`;
      if (previous.length) {
        if (!previous.every((row) => row.matches))
          throw new Error('Falha de execução divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      // Início ainda não aplicado: a falha fica na inbox para reaplicação.
      if (['FILA_PENDENTE', 'NA_FILA'].includes(saga.status)) return 'PENDING';
      // A reconciliação por prazo de execução vencido é resolvida por este fato.
      const executing =
        saga.status === 'EM_EXECUCAO' ||
        (saga.status === 'RECONCILIACAO_NECESSARIA' &&
          saga.lastError === 'EXECUTION_DEADLINE_EXPIRED');
      if (executing) {
        const starts = await tx.$queryRaw<
          Array<{ matches: boolean }>
        >`SELECT ("payload"->'data'->>'startedAt' = ${d.startedAt}) AS "matches" FROM "Inbox" WHERE "consumer" = ${consumer} AND "type" = 'execution.work-started.v1' AND "status" = 'APPLIED' AND "payload"->>'sagaId' = ${event.sagaId}`;
        if (!starts.length || !starts.every((row) => row.matches))
          throw new Error('Falha de execução diverge do início');
      }
      const payments =
        executing && saga.chargeId
          ? await tx.$queryRaw<
              Array<{ paymentId: string }>
            >`SELECT DISTINCT "payload"->'data'->>'paymentId' AS "paymentId" FROM "Inbox" WHERE "consumer" = ${consumer} AND "type" = 'billing.payment-confirmed.v1' AND "status" = 'APPLIED' AND "payload"->>'sagaId' = ${event.sagaId} AND "payload"->'data'->>'chargeId' = ${saga.chargeId}`
          : [];
      const refunds = await tx.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) AS count FROM "SagaOperation" WHERE "sagaId" = ${event.sagaId} AND "commandType" = 'billing.refund-payment.v1'`;
      if (
        executing &&
        payments.length === 1 &&
        payments[0].paymentId &&
        refunds[0].count === 0n
      ) {
        const operationId = randomUUID();
        const messageId = randomUUID();
        const type = 'billing.refund-payment.v1';
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
          correlationId: event.correlationId ?? event.sagaId,
          ...forwardTrace(event),
          causationId: event.messageId,
          operationId,
          data: {
            refundId: randomUUID(),
            paymentId: payments[0].paymentId,
            cancelOperationId: event.operationId,
            cancelEventId: event.messageId,
            reason: 'EXECUTION_FAILED',
          },
        };
        await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${event.sagaId}, 'REFUND_PAYMENT', 1, ${type}, 'PENDING', NOW())`;
        await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'REEMBOLSO_PENDENTE', "requiresAttention" = false, "lastError" = 'EXECUTION_FAILED', "deadlineAt" = NULL, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      } else {
        // Sem pagamento único comprovado (ou fora da execução) não há estorno
        // automático seguro: o operador decide com a falha registrada.
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "lastError" = 'EXECUTION_FAILED', "deadlineAt" = NULL, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      }
      if (executing) {
        await tx.$executeRaw`UPDATE "OrdemDeServico" SET "status" = 'FALHA_EXECUCAO', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.osId}`;
        await tx.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id", "osId", "status", "ocorridoEm") VALUES (${randomUUID()}, ${event.osId}, 'FALHA_EXECUCAO', ${failedAt})`;
      }
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
