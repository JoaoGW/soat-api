import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ReviewSagaDeadlines } from '../../src/infrastructure/saga/RevisarPrazos';
import { StartCompensation } from '../../src/infrastructure/saga/IniciarCompensacao';
import {
  ReceiveCancellationEvent,
  CancellationEvent,
} from '../../src/infrastructure/saga/ReceberCancelamento';
import {
  ReceiveRefundEvent,
  RefundEvent,
} from '../../src/infrastructure/saga/ReceberReembolso';
import { DispatchCommands } from '../../src/infrastructure/saga/PublicarComandos';
import { RetryFailedCommand } from '../../src/infrastructure/saga/ReprocessarComando';
import {
  sagaDeadlineAt,
  sagaDeadlineMinutes,
} from '../../src/infrastructure/saga/PrazosSaga';

const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');

type Command = {
  messageId: string;
  operationId: string;
  data: Record<string, string>;
};

describe('prazos da Saga e falha definitiva da outbox', () => {
  const db = new PrismaClient();
  const prefix = randomUUID();
  const client = `client-${prefix}`;
  const vehicle = `vehicle-${prefix}`;
  const expired = new Date('1990-01-01T00:00:00Z');
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
  async function seed(status: string, deadlineAt: Date | null = expired) {
    const id = randomUUID();
    const queued = status === 'NA_FILA';
    const ids = {
      id,
      osId: `os-${id}`,
      sagaId: `saga-${id}`,
      quoteId: queued || status === 'AGUARDANDO_APROVACAO' ? `q-${id}` : null,
      reservationId: queued ? `res-${id}` : null,
      chargeId: queued ? `charge-${id}` : null,
      executionId: queued ? `execution-${id}` : null,
      paymentId: `payment-${id}`,
    };
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${ids.osId}, ${id}, ${client}, ${vehicle}, 'branch', 'RECEBIDA', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "quoteId", "quoteVersion", "reservationId", "chargeId", "executionId", "deadlineAt", "updatedAt") VALUES (${ids.sagaId}, ${ids.osId}, 'branch', ${status}, ${ids.quoteId}, ${ids.quoteId ? 1 : null}, ${ids.reservationId}, ${ids.chargeId}, ${ids.executionId}, ${deadlineAt}, NOW())`;
    return ids;
  }
  async function state(sagaId: string) {
    const rows = await db.$queryRaw<
      Array<{
        status: string;
        requiresAttention: boolean;
        lastError: string | null;
        deadlineAt: Date | null;
      }>
    >`SELECT "status", "requiresAttention", "lastError", "deadlineAt" FROM "SagaInstance" WHERE "id" = ${sagaId}`;
    return rows[0];
  }
  async function outbox(sagaId: string, type: string) {
    return db.$queryRaw<
      Array<{ payload: Command }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = ${type} AND "payload"->>'sagaId' = ${sagaId}`;
  }

  it('lê prazos configuráveis com padrão seguro', () => {
    expect(sagaDeadlineMinutes('SAGA_QUEUE_DEADLINE_MINUTES', {})).toBe(4320);
    expect(
      sagaDeadlineMinutes('SAGA_QUEUE_DEADLINE_MINUTES', {
        SAGA_QUEUE_DEADLINE_MINUTES: ' 30 ',
      }),
    ).toBe(30);
    for (const invalid of ['0', '-5', '1.5', 'abc', '9999999'])
      expect(
        sagaDeadlineMinutes('SAGA_DIAGNOSIS_DEADLINE_MINUTES', {
          SAGA_DIAGNOSIS_DEADLINE_MINUTES: invalid,
        }),
      ).toBe(1440);
    expect(
      sagaDeadlineAt('SAGA_EXECUTION_DEADLINE_MINUTES', expired, {}),
    ).toEqual(new Date(expired.getTime() + 2880 * 60000));
  });

  it('prazo vencido na fila inicia a compensação uma única vez e segue o estorno normal', async () => {
    const ctx = await seed('NA_FILA');
    const review = new ReviewSagaDeadlines(db);
    await Promise.all([
      review.execute(new Date(), 100),
      review.execute(new Date(), 100),
    ]);
    expect(await state(ctx.sagaId)).toEqual({
      status: 'COMPENSANDO',
      requiresAttention: false,
      lastError: null,
      deadlineAt: null,
    });
    const cancels = await outbox(ctx.sagaId, 'execution.cancel-work.v1');
    expect(cancels).toHaveLength(1);
    expect(cancels[0].payload.data).toEqual({
      reason: 'DEADLINE_EXPIRED',
      executionId: ctx.executionId,
    });
    // Execution confirma o cancelamento: o caminho de estorno + liberação de
    // peças continua igual ao da compensação manual.
    const payment = {
      sagaId: ctx.sagaId,
      data: {
        chargeId: ctx.chargeId,
        paymentId: ctx.paymentId,
        amountInCents: 500,
        providerOrderId: `order-${ctx.id}`,
      },
    };
    await db.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES ('os.saga-events', ${`payment-${ctx.id}`}, ${`payment-op-${ctx.id}`}, 'billing.payment-confirmed.v1', ${JSON.stringify(payment)}::jsonb, 'APPLIED')`;
    const cancelled: CancellationEvent = {
      messageId: `cancelled-${ctx.id}`,
      operationId: cancels[0].payload.operationId,
      type: 'execution.work-cancelled.v1',
      producer: 'soat-execution-service',
      osId: ctx.osId,
      sagaId: ctx.sagaId,
      filialId: 'branch',
      data: {
        outcome: 'CANCELLED',
        reason: 'DEADLINE_EXPIRED',
        executionId: ctx.executionId!,
      },
    };
    expect(await new ReceiveCancellationEvent(db).execute(cancelled)).toBe(
      'APPLIED',
    );
    const [refund] = await outbox(ctx.sagaId, 'billing.refund-payment.v1');
    expect(refund.payload.data.reason).toBe('SAGA_COMPENSATION');
    const event: RefundEvent = {
      messageId: `refunded-${ctx.id}`,
      operationId: refund.payload.operationId,
      type: 'billing.payment-refunded.v1',
      producer: 'soat-billing-service',
      osId: ctx.osId,
      sagaId: ctx.sagaId,
      filialId: 'branch',
      correlationId: ctx.id,
      data: {
        refundId: refund.payload.data.refundId,
        paymentId: ctx.paymentId,
        chargeId: ctx.chargeId!,
        quoteId: ctx.quoteId!,
        quoteVersion: 1,
        amountInCents: 500,
        currency: 'BRL',
        providerOrderId: `order-${ctx.id}`,
        providerRefundId: `provider-${ctx.id}`,
        cancelOperationId: cancelled.operationId,
      },
    };
    expect(await new ReceiveRefundEvent(db).execute(event)).toBe('APPLIED');
    expect((await state(ctx.sagaId)).status).toBe('LIBERACAO_PENDENTE');
    expect(await outbox(ctx.sagaId, 'execution.release-parts.v1')).toHaveLength(
      1,
    );
  });

  it('prazo vencido no diagnóstico cancela a OS após confirmação de Execution', async () => {
    const ctx = await seed('DIAGNOSTICO_PENDENTE');
    await new ReviewSagaDeadlines(db).execute(new Date(), 100);
    const [cancel] = await outbox(ctx.sagaId, 'execution.cancel-work.v1');
    expect(cancel.payload.data).toEqual({ reason: 'DEADLINE_EXPIRED' });
    expect(
      await new ReceiveCancellationEvent(db).execute({
        messageId: `cancelled-${ctx.id}`,
        operationId: cancel.payload.operationId,
        type: 'execution.work-cancelled.v1',
        producer: 'soat-execution-service',
        osId: ctx.osId,
        sagaId: ctx.sagaId,
        filialId: 'branch',
        data: { outcome: 'CANCELLED', reason: 'DEADLINE_EXPIRED' },
      }),
    ).toBe('APPLIED');
    expect((await state(ctx.sagaId)).status).toBe('COMPENSADA');
    const [os] = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "OrdemDeServico" WHERE "id" = ${ctx.osId}`;
    expect(os.status).toBe('CANCELADA');
  });

  it('aprovação vencida compensa e prazos futuros ou etapas com comando em voo não', async () => {
    const approval = await seed('AGUARDANDO_APROVACAO');
    const future = await seed('NA_FILA', new Date(Date.now() + 3600000));
    const inFlight = await seed('ORCAMENTO_PENDENTE');
    await new ReviewSagaDeadlines(db).execute(new Date(), 100);
    expect((await state(approval.sagaId)).status).toBe('COMPENSANDO');
    expect((await state(future.sagaId)).status).toBe('NA_FILA');
    expect(await state(inFlight.sagaId)).toMatchObject({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
      lastError: 'DEADLINE_EXPIRED',
    });
    expect(
      await outbox(inFlight.sagaId, 'execution.cancel-work.v1'),
    ).toHaveLength(0);
    const compensation = new StartCompensation(db);
    expect(await compensation.startExpired(future.sagaId)).toBe('SKIPPED');
    await expect(compensation.startExpired('')).rejects.toThrow('inválida');
  });

  it('erro em uma Saga não impede as demais e é reportado ao fim do ciclo', async () => {
    const first = await seed('NA_FILA', new Date('1980-01-01T00:00:00Z'));
    const second = await seed('NA_FILA', new Date('1980-01-01T00:00:01Z'));
    const real = new StartCompensation(db);
    const flaky = {
      startExpired: jest.fn((id: string, now: Date) =>
        id === first.sagaId
          ? Promise.reject(new Error('falha'))
          : real.startExpired(id, now),
      ),
    } as unknown as StartCompensation;
    const review = new ReviewSagaDeadlines(db, flaky);
    await expect(review.execute(new Date(), 100)).rejects.toThrow(
      'não iniciada',
    );
    expect((await state(first.sagaId)).status).toBe('NA_FILA');
    expect((await state(second.sagaId)).status).toBe('COMPENSANDO');
    await expect(review.execute(new Date('x'))).rejects.toThrow(
      'Parâmetros inválidos',
    );
    await new ReviewSagaDeadlines(db).execute(new Date(), 100);
    expect((await state(first.sagaId)).status).toBe('COMPENSANDO');
  });

  it('outbox FAILED sinaliza a Saga na mesma transação e o reprocessamento limpa o alerta', async () => {
    const ctx = await seed('COBRANCA_PENDENTE', null);
    const messageId = randomUUID();
    const operationId = `charge-op-${ctx.id}`;
    const old = new Date('1985-01-01T00:00:00Z');
    const payload = {
      messageId,
      operationId,
      type: 'billing.create-charge.v1',
      sagaId: ctx.sagaId,
    };
    await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${ctx.sagaId}, 'CREATE_CHARGE', 1, ${payload.type}, 'PENDING', NOW())`;
    await db.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload", "attemptCount", "createdAt", "nextAttemptAt") VALUES (${messageId}, ${payload.type}, ${JSON.stringify(payload)}::jsonb, 4, ${old}, ${old})`;
    const publish = jest.fn().mockRejectedValue(new Error('broker'));
    expect(
      await new DispatchCommands(db, { publish }).execute(
        new Date('2030-01-01T00:00:00Z'),
      ),
    ).toBe('FAILED');
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ messageId }),
    );
    const [row] = await db.$queryRaw<
      Array<{ status: string; attemptCount: number }>
    >`SELECT "status", "attemptCount" FROM "Outbox" WHERE "messageId" = ${messageId}`;
    expect(row).toEqual({ status: 'FAILED', attemptCount: 5 });
    expect(await state(ctx.sagaId)).toMatchObject({
      status: 'COBRANCA_PENDENTE',
      requiresAttention: true,
      lastError: 'OUTBOX_FAILED',
    });
    await new RetryFailedCommand(db).execute({
      sagaId: ctx.sagaId,
      messageId,
      actorId: 'admin',
      reason: 'BROKER_RESTORED',
    });
    expect(await state(ctx.sagaId)).toMatchObject({
      status: 'COBRANCA_PENDENTE',
      requiresAttention: false,
      lastError: null,
    });
    const [rearmed] = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "Outbox" WHERE "messageId" = ${messageId}`;
    expect(rearmed.status).toBe('PENDING');
    // Não deixa mensagem antiga pendente para os demais testes da outbox.
    await db.$executeRaw`DELETE FROM "Outbox" WHERE "messageId" = ${messageId}`;
  });

  it('publica lotes em ordem de criação sem esperar entre mensagens', async () => {
    const base = new Date('1986-01-01T00:00:00Z').getTime();
    const ids = [0, 1, 2].map(() => randomUUID());
    for (const [index, id] of ids.entries()) {
      const at = new Date(base + index * 1000);
      await db.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload", "createdAt", "nextAttemptAt") VALUES (${id}, 'execution.request-diagnosis.v1', ${JSON.stringify({ messageId: id })}::jsonb, ${at}, ${at})`;
    }
    const publish = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new DispatchCommands(db, { publish });
    const clock = () => new Date('2030-01-01T00:00:00Z');
    expect(await dispatcher.drain(2, clock)).toEqual({
      processed: 2,
      drained: false,
    });
    expect(await dispatcher.drain(1, clock)).toEqual({
      processed: 1,
      drained: false,
    });
    expect(publish.mock.calls.map(([item]) => item.messageId)).toEqual(ids);
    await expect(dispatcher.drain(0)).rejects.toThrow('Lote inválido');
  });
});
