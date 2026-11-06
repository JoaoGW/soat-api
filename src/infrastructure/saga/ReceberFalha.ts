import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { forwardTrace } from '../observability/TraceContext';
export type FailureEvent = {
  messageId: string;
  operationId: string;
  sagaId: string;
  osId: string;
  filialId: string;
  correlationId: string;
  type:
    | 'billing.quote-failed.v1'
    | 'billing.charge-failed.v1'
    | 'execution.parts-reservation-failed.v1';
  producer: string;
  data: Record<string, unknown>;
};
type Saga = {
  osId: string;
  filialId: string;
  status: string;
  version: number;
  quoteId: string | null;
  quoteVersion: number | null;
  reservationId: string | null;
  executionId: string | null;
  chargeId: string | null;
  requiresAttention: boolean;
  lastError: string | null;
};
export class ReceiveFailureEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    event: FailureEvent,
    now = new Date(),
  ): Promise<'APPLIED' | 'PENDING'> {
    const mapping: Record<
      string,
      { producer: string; command: string; state: string }
    > = {
      'billing.quote-failed.v1': {
        producer: 'soat-billing-service',
        command: 'billing.generate-quote.v1',
        state: 'ORCAMENTO_PENDENTE',
      },
      'billing.charge-failed.v1': {
        producer: 'soat-billing-service',
        command: 'billing.create-charge.v1',
        state: 'COBRANCA_PENDENTE',
      },
      'execution.parts-reservation-failed.v1': {
        producer: 'soat-execution-service',
        command: 'execution.reserve-parts.v1',
        state: 'RESERVA_PENDENTE',
      },
    };
    const config = mapping[event?.type];
    if (
      !config ||
      event.producer !== config.producer ||
      ![
        event.messageId,
        event.operationId,
        event.sagaId,
        event.osId,
        event.filialId,
        event.correlationId,
      ].every((id) => typeof id === 'string' && id.length > 0) ||
      !event.data ||
      typeof event.data !== 'object' ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Falha inválida');
    const encoded = JSON.stringify(event);
    const consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Saga[]
      >`SELECT "osId", "filialId", "status", "version", "quoteId", "quoteVersion", "reservationId", "executionId", "chargeId", "requiresAttention", "lastError" FROM "SagaInstance" WHERE "id" = ${event.sagaId} FOR UPDATE`;
      const saga = rows[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Falha não corresponde à Saga');
      const commands = await tx.$queryRaw<
        Array<{
          status: string;
          payload: { data: Record<string, unknown> };
          sameResult: boolean | null;
        }>
      >`SELECT op."status", o."payload", (op."result"->'data' = ${JSON.stringify(event.data)}::jsonb) AS "sameResult" FROM "SagaOperation" op JOIN "Outbox" o ON o."payload"->>'operationId' = op."operationId" WHERE op."operationId" = ${event.operationId} AND op."sagaId" = ${event.sagaId} AND op."commandType" = ${config.command} AND o."type" = ${config.command}`;
      const command = commands[0];
      const data = command?.payload?.data;
      if (commands.length !== 1 || !data)
        throw new Error('Comando da falha não encontrado');
      if (
        event.type === 'billing.quote-failed.v1' &&
        (data.diagnosisId !== event.data.diagnosisId ||
          data.diagnosisVersion !== event.data.diagnosisVersion ||
          !['EXPIRED', 'ALREADY_EXISTS'].includes(
            String(event.data.reasonCode),
          ))
      )
        throw new Error('Falha diverge do comando');
      if (
        event.type === 'execution.parts-reservation-failed.v1' &&
        (data.quoteId !== event.data.quoteId ||
          data.quoteVersion !== event.data.quoteVersion ||
          data.reservationId !== event.data.reservationId ||
          !['EXPIRED', 'INSUFFICIENT_STOCK'].includes(
            String(event.data.reason),
          ))
      )
        throw new Error('Falha diverge do comando');
      if (
        event.type === 'billing.charge-failed.v1' &&
        (data.quoteId !== event.data.quoteId ||
          data.quoteVersion !== event.data.quoteVersion ||
          data.reservationId !== event.data.reservationId ||
          data.chargeId !== event.data.chargeId ||
          event.data.reasonCode !== 'EXPIRED')
      )
        throw new Error('Falha diverge do comando');
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches)
        throw new Error('Mensagem reutilizada com outro conteúdo');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      // Um prazo vencido não prova nada por si só. A falha EXPIRED assinada
      // do Billing, vinculada ao comando e sem fatos posteriores, comprova
      // que esse orçamento não foi criado e permite iniciar o cancelamento.
      if (
        saga.status === 'RECONCILIACAO_NECESSARIA' &&
        saga.requiresAttention &&
        saga.lastError === 'DEADLINE_EXPIRED' &&
        event.type === 'billing.quote-failed.v1' &&
        event.data.reasonCode === 'EXPIRED' &&
        !saga.quoteId &&
        !saga.reservationId &&
        !saga.chargeId &&
        !saga.executionId &&
        ['PENDING', 'SENT'].includes(command.status)
      ) {
        const conflicts = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT (SELECT count(*) FROM "SagaOperation" WHERE "sagaId"=${event.sagaId} AND "commandType" IN ('execution.reserve-parts.v1','billing.create-charge.v1','execution.enqueue-work.v1','execution.cancel-work.v1','billing.refund-payment.v1','execution.release-parts.v1')) +
                 (SELECT count(*) FROM "Inbox" WHERE "consumer"=${consumer} AND "payload"->>'sagaId'=${event.sagaId} AND "type" IN ('billing.quote-issued.v1','billing.quote-approved.v1','billing.quote-rejected.v1','billing.payment-confirmed.v1','execution.work-started.v1')) AS count`;
        if (conflicts[0].count === 0n) {
          await tx.$executeRaw`UPDATE "SagaInstance" SET "status"='ORCAMENTO_PENDENTE', "requiresAttention"=false, "lastError"=NULL, "deadlineAt"=NULL, "version"="version"+1, "updatedAt"=NOW() WHERE "id"=${event.sagaId}`;
          await tx.$executeRaw`INSERT INTO "SagaRecoveryAudit" ("id","sagaId","messageId","actorId","reason") VALUES (${randomUUID()},${event.sagaId},${event.messageId},'saga-worker','AUTHENTICATED_QUOTE_EXPIRED')`;
          saga.status = 'ORCAMENTO_PENDENTE';
          saga.version++;
        }
      }
      // A falha definitiva vinculada ao comando prova que a reserva não foi
      // criada ou que a cobrança expirou antes do envio. Somente retoma se
      // não houver fatos/ações posteriores que contradigam essa prova.
      if (
        saga.status === 'RECONCILIACAO_NECESSARIA' &&
        saga.requiresAttention &&
        saga.lastError === 'DEADLINE_EXPIRED' &&
        [
          'execution.parts-reservation-failed.v1',
          'billing.charge-failed.v1',
        ].includes(event.type) &&
        saga.quoteId === event.data.quoteId &&
        saga.quoteVersion === event.data.quoteVersion &&
        saga.reservationId === event.data.reservationId &&
        !saga.chargeId &&
        !saga.executionId &&
        ['PENDING', 'SENT'].includes(command.status)
      ) {
        const reservationFailure =
          event.type === 'execution.parts-reservation-failed.v1';
        const conflicts = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT (SELECT count(*) FROM "SagaOperation" WHERE "sagaId"=${event.sagaId} AND ("commandType" IN ('execution.enqueue-work.v1','execution.cancel-work.v1','billing.refund-payment.v1','execution.release-parts.v1') OR (${reservationFailure} AND "commandType"='billing.create-charge.v1'))) +
                 (SELECT count(*) FROM "Inbox" WHERE "consumer"=${consumer} AND "payload"->>'sagaId'=${event.sagaId} AND ("type" IN ('billing.charge-created.v1','billing.payment-confirmed.v1','execution.work-enqueued.v1','execution.work-started.v1') OR (${reservationFailure} AND "type"='execution.parts-reserved.v1'))) AS count`;
        if (conflicts[0].count === 0n) {
          await tx.$executeRaw`UPDATE "SagaInstance" SET "status"=${config.state}, "requiresAttention"=false, "lastError"=NULL, "deadlineAt"=NULL, "version"="version"+1, "updatedAt"=NOW() WHERE "id"=${event.sagaId}`;
          await tx.$executeRaw`INSERT INTO "SagaRecoveryAudit" ("id","sagaId","messageId","actorId","reason") VALUES (${randomUUID()},${event.sagaId},${event.messageId},'saga-worker',${reservationFailure ? 'AUTHENTICATED_RESERVATION_FAILED' : 'AUTHENTICATED_CHARGE_EXPIRED'})`;
          saga.status = config.state;
          saga.version++;
        }
      }
      if (command.status === 'FAILED') {
        if (!command.sameResult) throw new Error('Falha divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (
        saga.status !== config.state ||
        !['PENDING', 'SENT'].includes(command.status)
      )
        return 'PENDING';
      if (
        event.type !== 'billing.quote-failed.v1' &&
        (saga.quoteId !== event.data.quoteId ||
          saga.quoteVersion !== event.data.quoteVersion ||
          saga.reservationId !== event.data.reservationId)
      )
        return 'PENDING';
      const ambiguous =
        event.type === 'billing.quote-failed.v1' &&
        event.data.reasonCode === 'ALREADY_EXISTS';
      if (ambiguous)
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      else {
        const operationId = randomUUID();
        const messageId = randomUUID();
        const type = 'execution.cancel-work.v1';
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
          ...forwardTrace(event),
          causationId: event.messageId,
          operationId,
          data: {
            reason: 'STEP_FAILED',
            ...(saga.executionId ? { executionId: saga.executionId } : {}),
          },
        };
        await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${event.sagaId}, 'CANCEL_WORK', 1, ${type}, 'PENDING', NOW())`;
        await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
        if (event.type === 'execution.parts-reservation-failed.v1')
          await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COMPENSANDO', "reservationId" = NULL, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
        else
          await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COMPENSANDO', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      }
      await tx.$executeRaw`UPDATE "SagaOperation" SET "status" = 'FAILED', "result" = ${encoded}::jsonb, "updatedAt" = NOW() WHERE "operationId" = ${event.operationId}`;
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
