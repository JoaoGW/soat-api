import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  ReceiveWorkFailedEvent,
  WorkFailedEvent,
} from '../../src/infrastructure/saga/ReceberFalhaExecucao';
import {
  ReceiveRefundEvent,
  RefundEvent,
} from '../../src/infrastructure/saga/ReceberReembolso';
import {
  ReceiveFailureEvent,
  FailureEvent,
} from '../../src/infrastructure/saga/ReceberFalha';
import {
  ReceiveRepairEvent,
  RepairEvent,
} from '../../src/infrastructure/saga/ReceberReparo';
import { ReviewSagaDeadlines } from '../../src/infrastructure/saga/RevisarPrazos';
import { workFailedEventValidator } from '../../src/infrastructure/service-bus/RepairEventConsumer';
import { contractValidator } from '../../src/infrastructure/service-bus/ContractEventConsumer';

const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');

type Refund = {
  messageId: string;
  operationId: string;
  data: {
    refundId: string;
    paymentId: string;
    cancelOperationId: string;
    cancelEventId: string;
    reason: string;
  };
};

describe('falha na execução após o pagamento', () => {
  const db = new PrismaClient();
  const handler = new ReceiveWorkFailedEvent(db);
  const refunds = new ReceiveRefundEvent(db);
  const contracts = resolve(process.cwd(), 'docs/contracts/messages');
  const validFailure = workFailedEventValidator(contracts);
  const validRefund = contractValidator(contracts, [
    'billing.refund-payment.v1',
  ]);
  const prefix = randomUUID();
  const client = `client-${prefix}`;
  const vehicle = `vehicle-${prefix}`;
  const startedAt = '2025-01-01T00:00:00.000Z';
  beforeAll(async () => {
    const doc = String(
      BigInt('0x' + prefix.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
    await db.$executeRaw`INSERT INTO "Cliente" ("id", "nome", "documento", "tipo", "contato", "updatedAt") VALUES (${client}, 'T', ${doc}, 'PF', 'x', NOW())`;
    await db.$executeRaw`INSERT INTO "Veiculo" ("id", "clienteId", "placa", "marca", "modelo", "ano", "updatedAt") VALUES (${vehicle}, ${client}, ${prefix.slice(0, 7)}, 'X', 'Y', 2020, NOW())`;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function seed(
    status = 'EM_EXECUCAO',
    options: { paid?: boolean; started?: boolean; lastError?: string } = {},
  ) {
    const { paid = true, started = true, lastError = null } = options;
    const id = randomUUID();
    const ids = {
      osId: `os-${id}`,
      sagaId: `saga-${id}`,
      executionId: `execution-${id}`,
      reservationId: `res-${id}`,
      chargeId: `charge-${id}`,
      quoteId: `quote-${id}`,
      paymentId: `payment-${id}`,
    };
    const requiresAttention = status === 'RECONCILIACAO_NECESSARIA';
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${ids.osId}, ${id}, ${client}, ${vehicle}, 'branch', 'EM_EXECUCAO', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "quoteId", "quoteVersion", "reservationId", "chargeId", "executionId", "requiresAttention", "lastError", "updatedAt") VALUES (${ids.sagaId}, ${ids.osId}, 'branch', ${status}, ${ids.quoteId}, 1, ${ids.reservationId}, ${ids.chargeId}, ${ids.executionId}, ${requiresAttention}, ${lastError}, NOW())`;
    if (paid) {
      const payment = {
        sagaId: ids.sagaId,
        data: {
          chargeId: ids.chargeId,
          paymentId: ids.paymentId,
          amountInCents: 500,
          providerOrderId: `order-${id}`,
        },
      };
      await db.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES ('os.saga-events', ${`payment-${id}`}, ${`payment-op-${id}`}, 'billing.payment-confirmed.v1', ${JSON.stringify(payment)}::jsonb, 'APPLIED')`;
    }
    if (started) {
      const start = {
        sagaId: ids.sagaId,
        data: {
          executionId: ids.executionId,
          reservationId: ids.reservationId,
          startedAt,
        },
      };
      await db.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES ('os.saga-events', ${`start-${id}`}, ${`start-op-${id}`}, 'execution.work-started.v1', ${JSON.stringify(start)}::jsonb, 'APPLIED')`;
    }
    const failed: WorkFailedEvent & Record<string, unknown> = {
      messageId: `failed-${id}`,
      type: 'execution.work-failed.v1',
      schemaVersion: 1,
      occurredAt: '2025-01-01T02:00:00.000Z',
      producer: 'soat-execution-service',
      aggregateType: 'execution',
      aggregateId: ids.executionId,
      aggregateVersion: 3,
      osId: ids.osId,
      sagaId: ids.sagaId,
      filialId: 'branch',
      correlationId: id,
      causationId: `start-${id}`,
      operationId: `failed-op-${id}`,
      data: {
        executionId: ids.executionId,
        reservationId: ids.reservationId,
        startedAt,
        failedAt: '2025-01-01T02:00:00.000Z',
        reason: 'REPARO_INVIAVEL',
      },
    };
    return { id, ...ids, failed };
  }
  async function saga(sagaId: string) {
    const rows = await db.$queryRaw<
      Array<{
        status: string;
        requiresAttention: boolean;
        lastError: string | null;
      }>
    >`SELECT "status", "requiresAttention", "lastError" FROM "SagaInstance" WHERE "id" = ${sagaId}`;
    return rows[0];
  }
  async function order(osId: string) {
    const rows = await db.$queryRaw<
      Array<{ status: string; history: string[] }>
    >`SELECT o."status", ARRAY(SELECT h."status" FROM "HistoricoStatusOS" h WHERE h."osId" = o."id" ORDER BY h."ocorridoEm", h."id") AS "history" FROM "OrdemDeServico" o WHERE o."id" = ${osId}`;
    return rows[0];
  }
  async function commands(sagaId: string, type: string) {
    return db.$queryRaw<
      Array<{ payload: Refund }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = ${type} AND "payload"->>'sagaId' = ${sagaId}`;
  }
  function refunded(
    ctx: Awaited<ReturnType<typeof seed>>,
    command: Refund,
  ): RefundEvent {
    return {
      messageId: `refunded-${ctx.id}`,
      operationId: command.operationId,
      type: 'billing.payment-refunded.v1',
      producer: 'soat-billing-service',
      osId: ctx.osId,
      sagaId: ctx.sagaId,
      filialId: 'branch',
      correlationId: ctx.id,
      data: {
        refundId: command.data.refundId,
        paymentId: ctx.paymentId,
        chargeId: ctx.chargeId,
        quoteId: ctx.quoteId,
        quoteVersion: 1,
        amountInCents: 500,
        currency: 'BRL',
        providerOrderId: `order-${ctx.id}`,
        providerRefundId: `provider-refund-${ctx.id}`,
        cancelOperationId: command.data.cancelOperationId,
      },
    };
  }
  function blocked(
    ctx: Awaited<ReturnType<typeof seed>>,
    command: Refund,
    reasonCode: string,
  ): FailureEvent {
    return {
      messageId: `blocked-${reasonCode}-${ctx.id}`,
      operationId: command.operationId,
      causationId: command.messageId,
      type: 'billing.refund-blocked.v1',
      producer: 'soat-billing-service',
      osId: ctx.osId,
      sagaId: ctx.sagaId,
      filialId: 'branch',
      correlationId: ctx.id,
      data: {
        refundId: command.data.refundId,
        paymentId: command.data.paymentId,
        cancelOperationId: command.data.cancelOperationId,
        cancelEventId: command.data.cancelEventId,
        reasonCode,
      },
    };
  }

  it('estorna o pagamento e cancela a OS sem liberar peças consumidas', async () => {
    const ctx = await seed();
    expect(validFailure(ctx.failed)).toBe(true);
    await expect(
      handler.execute({
        ...ctx.failed,
        data: { ...ctx.failed.data, executionId: 'other' },
      }),
    ).rejects.toThrow('não corresponde');
    await expect(
      handler.execute({
        ...ctx.failed,
        data: { ...ctx.failed.data, startedAt: '2025-01-01T00:30:00.000Z' },
      }),
    ).rejects.toThrow('diverge do início');
    expect(
      await Promise.all([
        handler.execute(ctx.failed),
        handler.execute(ctx.failed),
      ]),
    ).toEqual(['APPLIED', 'APPLIED']);
    expect(await saga(ctx.sagaId)).toEqual({
      status: 'REEMBOLSO_PENDENTE',
      requiresAttention: false,
      lastError: 'EXECUTION_FAILED',
    });
    expect(await order(ctx.osId)).toEqual({
      status: 'FALHA_EXECUCAO',
      history: ['FALHA_EXECUCAO'],
    });
    const [refund, ...others] = await commands(
      ctx.sagaId,
      'billing.refund-payment.v1',
    );
    expect(others).toHaveLength(0);
    expect(validRefund(refund.payload)).toBe(true);
    expect(refund.payload.data).toEqual({
      refundId: expect.any(String),
      paymentId: ctx.paymentId,
      cancelOperationId: ctx.failed.operationId,
      cancelEventId: ctx.failed.messageId,
      reason: 'EXECUTION_FAILED',
    });
    // Reentrega com outro identificador e mesmo fato não gera novo estorno.
    expect(
      await handler.execute({ ...ctx.failed, messageId: `again-${ctx.id}` }),
    ).toBe('APPLIED');
    await expect(
      handler.execute({
        ...ctx.failed,
        messageId: `other-${ctx.id}`,
        data: { ...ctx.failed.data, reason: 'OUTRO' },
      }),
    ).rejects.toThrow('divergente');
    expect(
      await commands(ctx.sagaId, 'billing.refund-payment.v1'),
    ).toHaveLength(1);

    const event = refunded(ctx, refund.payload);
    expect(
      await Promise.all([refunds.execute(event), refunds.execute(event)]),
    ).toEqual(['APPLIED', 'APPLIED']);
    expect(
      await refunds.execute({ ...event, messageId: `late-${ctx.id}` }),
    ).toBe('APPLIED');
    expect(await saga(ctx.sagaId)).toEqual({
      status: 'COMPENSADA',
      requiresAttention: false,
      lastError: 'EXECUTION_FAILED',
    });
    expect(await order(ctx.osId)).toEqual({
      status: 'CANCELADA',
      history: ['FALHA_EXECUCAO', 'CANCELADA'],
    });
    expect(
      await commands(ctx.sagaId, 'execution.release-parts.v1'),
    ).toHaveLength(0);
    const operations = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaOperation" WHERE "sagaId" = ${ctx.sagaId} AND "step" = 'REFUND_PAYMENT'`;
    expect(operations).toEqual([{ status: 'SUCCEEDED' }]);
  });

  it('sem pagamento confirmado exige reconciliação e não estorna', async () => {
    const ctx = await seed('EM_EXECUCAO', { paid: false });
    expect(await handler.execute(ctx.failed)).toBe('APPLIED');
    expect(await saga(ctx.sagaId)).toEqual({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
      lastError: 'EXECUTION_FAILED',
    });
    expect((await order(ctx.osId)).status).toBe('FALHA_EXECUCAO');
    expect(
      await commands(ctx.sagaId, 'billing.refund-payment.v1'),
    ).toHaveLength(0);
  });

  it('fora da execução registra a falha para o operador sem alterar a OS', async () => {
    const ctx = await seed('COMPENSANDO');
    expect(await handler.execute(ctx.failed)).toBe('APPLIED');
    expect(await saga(ctx.sagaId)).toEqual({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
      lastError: 'EXECUTION_FAILED',
    });
    expect((await order(ctx.osId)).status).toBe('EM_EXECUCAO');
    expect(
      await commands(ctx.sagaId, 'billing.refund-payment.v1'),
    ).toHaveLength(0);
  });

  it('falha recebida antes do início fica pendente e é reaplicada depois dele', async () => {
    const ctx = await seed('NA_FILA', { started: false });
    await expect(
      handler.execute({
        ...ctx.failed,
        data: { ...ctx.failed.data, failedAt: '2024-12-31T00:00:00.000Z' },
      }),
    ).rejects.toThrow('inválida');
    expect(await handler.execute(ctx.failed)).toBe('PENDING');
    const start: RepairEvent = {
      messageId: `start-event-${ctx.id}`,
      operationId: `start-event-op-${ctx.id}`,
      type: 'execution.work-started.v1',
      producer: 'soat-execution-service',
      osId: ctx.osId,
      sagaId: ctx.sagaId,
      filialId: 'branch',
      data: {
        executionId: ctx.executionId,
        reservationId: ctx.reservationId,
        startedAt,
      },
    };
    const now = new Date();
    expect(await new ReceiveRepairEvent(db).execute(start, now)).toBe(
      'APPLIED',
    );
    const [deadline] = await db.$queryRaw<
      Array<{ deadlineAt: Date }>
    >`SELECT "deadlineAt" FROM "SagaInstance" WHERE "id" = ${ctx.sagaId}`;
    expect(deadline.deadlineAt.getTime()).toBe(now.getTime() + 2880 * 60000);
    expect(await handler.execute(ctx.failed)).toBe('APPLIED');
    expect((await saga(ctx.sagaId)).status).toBe('REEMBOLSO_PENDENTE');
  });

  it('prazo de execução vencido reconcilia e a falha posterior retoma o estorno', async () => {
    const ctx = await seed();
    await db.$executeRaw`UPDATE "SagaInstance" SET "deadlineAt" = ${new Date('1990-01-01T00:00:00Z')} WHERE "id" = ${ctx.sagaId}`;
    await new ReviewSagaDeadlines(db).execute(new Date(), 100);
    expect(await saga(ctx.sagaId)).toEqual({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
      lastError: 'EXECUTION_DEADLINE_EXPIRED',
    });
    expect(
      await db.$queryRaw`SELECT 1 FROM "Outbox" WHERE "payload"->>'sagaId' = ${ctx.sagaId}`,
    ).toHaveLength(0);
    expect(await handler.execute(ctx.failed)).toBe('APPLIED');
    expect(await saga(ctx.sagaId)).toEqual({
      status: 'REEMBOLSO_PENDENTE',
      requiresAttention: false,
      lastError: 'EXECUTION_FAILED',
    });
  });

  it('estorno bloqueado por evidência divergente exige reconciliação', async () => {
    const ctx = await seed();
    expect(await handler.execute(ctx.failed)).toBe('APPLIED');
    const [refund] = await commands(ctx.sagaId, 'billing.refund-payment.v1');
    expect(
      await new ReceiveFailureEvent(db).execute(
        blocked(ctx, refund.payload, 'EVIDENCE_MISMATCH'),
      ),
    ).toBe('APPLIED');
    expect(await saga(ctx.sagaId)).toEqual({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
      lastError: 'REFUND_EVIDENCE_MISMATCH',
    });
    expect(await refunds.execute(refunded(ctx, refund.payload))).toBe(
      'PENDING',
    );
    expect((await order(ctx.osId)).status).toBe('FALHA_EXECUCAO');
  });

  it('resultado incerto do estorno é resolvido pela confirmação autenticada', async () => {
    const ctx = await seed();
    expect(await handler.execute(ctx.failed)).toBe('APPLIED');
    const [refund] = await commands(ctx.sagaId, 'billing.refund-payment.v1');
    expect(
      await new ReceiveFailureEvent(db).execute(
        blocked(ctx, refund.payload, 'PROVIDER_RESULT_UNKNOWN'),
      ),
    ).toBe('APPLIED');
    expect((await saga(ctx.sagaId)).lastError).toBe('REFUND_RESULT_UNKNOWN');
    expect(await refunds.execute(refunded(ctx, refund.payload))).toBe(
      'APPLIED',
    );
    expect(await saga(ctx.sagaId)).toEqual({
      status: 'COMPENSADA',
      requiresAttention: false,
      lastError: 'EXECUTION_FAILED',
    });
    expect((await order(ctx.osId)).status).toBe('CANCELADA');
    const audit = await db.$queryRaw<
      Array<{ reason: string }>
    >`SELECT "reason" FROM "SagaRecoveryAudit" WHERE "sagaId" = ${ctx.sagaId}`;
    expect(audit).toEqual([{ reason: 'AUTHENTICATED_REFUND_CONFIRMED' }]);
  });

  it('não conclui estorno de falha sem o evento de falha aplicado', async () => {
    const ctx = await seed('REEMBOLSO_PENDENTE');
    const operationId = `refund-op-${ctx.id}`;
    const payload: Refund & { sagaId: string } = {
      messageId: `refund-cmd-${ctx.id}`,
      operationId,
      sagaId: ctx.sagaId,
      data: {
        refundId: `refund-${ctx.id}`,
        paymentId: ctx.paymentId,
        cancelOperationId: `missing-op-${ctx.id}`,
        cancelEventId: `missing-${ctx.id}`,
        reason: 'EXECUTION_FAILED',
      },
    };
    await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${ctx.sagaId}, 'REFUND_PAYMENT', 1, 'billing.refund-payment.v1', 'SENT', NOW())`;
    await db.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${payload.messageId}, 'billing.refund-payment.v1', ${JSON.stringify(payload)}::jsonb)`;
    await expect(refunds.execute(refunded(ctx, payload))).rejects.toThrow(
      'sem falha de execução',
    );
    expect((await saga(ctx.sagaId)).status).toBe('REEMBOLSO_PENDENTE');
  });
});
