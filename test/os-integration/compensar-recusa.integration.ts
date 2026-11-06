import { StartCompensation } from '../../src/infrastructure/saga/IniciarCompensacao';
import {
  ReceiveFailureEvent,
  FailureEvent,
} from '../../src/infrastructure/saga/ReceberFalha';
import {
  ReceiveRefundEvent,
  RefundEvent,
} from '../../src/infrastructure/saga/ReceberReembolso';
import {
  ReceiveReleaseEvent,
  ReleaseEvent,
} from '../../src/infrastructure/saga/ReceberLiberacao';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  ReceiveQuoteEvent,
  QuoteEvent,
} from '../../src/infrastructure/saga/ReceberOrcamento';
import {
  ReceiveCancellationEvent,
  CancellationEvent,
} from '../../src/infrastructure/saga/ReceberCancelamento';
const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');
describe('compensação de recusa antes de pagamento', () => {
  const db = new PrismaClient();
  const id = randomUUID();
  const client = `client-${id}`;
  const vehicle = `vehicle-${id}`;
  const osId = `os-${id}`;
  const sagaId = `saga-${id}`;
  const operation = `quoteop-${id}`;
  const rejected: QuoteEvent = {
    messageId: `rejected-${id}`,
    operationId: `decision-${id}`,
    type: 'billing.quote-rejected.v1',
    producer: 'soat-billing-service',
    osId,
    sagaId,
    filialId: 'branch',
    correlationId: id,
    data: { quoteId: `quote-${id}`, quoteVersion: 1, clientId: client },
  };
  beforeAll(async () => {
    const document = String(
      BigInt('0x' + id.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
    await db.$executeRaw`INSERT INTO "Cliente" ("id", "nome", "documento", "tipo", "contato", "updatedAt") VALUES (${client}, 'Teste', ${document}, 'PF', 'test@example.test', NOW())`;
    await db.$executeRaw`INSERT INTO "Veiculo" ("id", "clienteId", "placa", "marca", "modelo", "ano", "updatedAt") VALUES (${vehicle}, ${client}, ${id.slice(0, 7)}, 'X', 'Y', 2020, NOW())`;
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${osId}, ${id}, ${client}, ${vehicle}, 'branch', 'AGUARDANDO_APROVACAO', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "quoteId", "quoteVersion", "updatedAt") VALUES (${sagaId}, ${osId}, 'branch', 'AGUARDANDO_APROVACAO', ${rejected.data.quoteId}, 1, NOW())`;
    await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operation}, ${sagaId}, 'GENERATE_QUOTE', 1, 'billing.generate-quote.v1', 'SUCCEEDED', NOW())`;
    const payload = {
      operationId: operation,
      sagaId,
      data: {
        clienteId: client,
        expiresAt: '2030-01-02T00:00:00.000Z',
        items: [
          {
            sourceId: 'p1',
            itemType: 'PART',
            quantity: 1,
            unitPriceInCents: 500,
          },
        ],
      },
    };
    await db.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${`command-${id}`}, 'billing.generate-quote.v1', ${JSON.stringify(payload)}::jsonb)`;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  it('registra cancelamento e só conclui após confirmação de Execution', async () => {
    expect(await new ReceiveQuoteEvent(db).execute(rejected)).toBe('APPLIED');
    const commands = await db.$queryRaw<
      Array<{ payload: { operationId: string; data: { reason: string } } }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'execution.cancel-work.v1' AND "payload"->>'sagaId' = ${sagaId}`;
    expect(commands).toHaveLength(1);
    const event: CancellationEvent = {
      messageId: `cancelled-${id}`,
      operationId: commands[0].payload.operationId,
      type: 'execution.work-cancelled.v1',
      producer: 'soat-execution-service',
      osId,
      sagaId,
      filialId: 'branch',
      data: { outcome: 'CANCELLED', reason: commands[0].payload.data.reason },
    };
    const handler = new ReceiveCancellationEvent(db);
    expect(
      await Promise.all([handler.execute(event), handler.execute(event)]),
    ).toEqual(['APPLIED', 'APPLIED']);
    const rows = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${sagaId}`;
    expect(rows[0].status).toBe('COMPENSADA');
    const os = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "OrdemDeServico" WHERE "id" = ${osId}`;
    expect(os[0].status).toBe('CANCELADA');
  });
  it.each([
    'normal',
    'resultado incerto',
    'conflito físico',
    'cancelamento conflitante',
    'aviso divergente subsequente',
    'evidência divergente',
  ] as const)('compensação financeira: %s', async (mode) => {
    const suffix = randomUUID();
    const os2 = `os-${suffix}`;
    const saga2 = `saga-${suffix}`;
    const paymentId = `payment-${suffix}`;
    const chargeId = `charge-${suffix}`;
    const reservationId = `res-${suffix}`;
    const quoteId = `quote-${suffix}`;
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${os2}, ${suffix}, ${client}, ${vehicle}, 'branch', 'NA_FILA', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "quoteId", "quoteVersion", "reservationId", "chargeId", "updatedAt") VALUES (${saga2}, ${os2}, 'branch', 'NA_FILA', ${quoteId}, 1, ${reservationId}, ${chargeId}, NOW())`;
    expect(
      await Promise.all([
        new StartCompensation(db).execute(saga2, 'SAGA_COMPENSATION'),
        new StartCompensation(db).execute(saga2, 'SAGA_COMPENSATION'),
      ]),
    ).toEqual(['STARTED', 'STARTED']);
    const cancelCommands = await db.$queryRaw<
      Array<{ operationId: string }>
    >`SELECT "operationId" FROM "SagaOperation" WHERE "sagaId" = ${saga2} AND "commandType" = 'execution.cancel-work.v1'`;
    expect(cancelCommands).toHaveLength(1);
    const cancelOp = cancelCommands[0].operationId;
    const payment = {
      sagaId: saga2,
      data: {
        chargeId,
        paymentId,
        amountInCents: 500,
        providerOrderId: 'order1',
      },
    };
    await db.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES ('os.saga-events', ${`payment-event-${suffix}`}, ${`payment-op-${suffix}`}, 'billing.payment-confirmed.v1', ${JSON.stringify(payment)}::jsonb, 'APPLIED')`;
    const cancelled: CancellationEvent = {
      messageId: `cancel-event-${suffix}`,
      operationId: cancelOp,
      type: 'execution.work-cancelled.v1',
      producer: 'soat-execution-service',
      osId: os2,
      sagaId: saga2,
      filialId: 'branch',
      data: { outcome: 'CANCELLED', reason: 'SAGA_COMPENSATION' },
    };
    expect(await new ReceiveCancellationEvent(db).execute(cancelled)).toBe(
      'APPLIED',
    );
    const refunds = await db.$queryRaw<
      Array<{
        payload: {
          messageId: string;
          operationId: string;
          data: {
            refundId: string;
            paymentId: string;
            cancelOperationId: string;
            cancelEventId: string;
          };
        };
      }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'billing.refund-payment.v1' AND "payload"->>'sagaId' = ${saga2}`;
    expect(refunds).toHaveLength(1);
    const command = refunds[0].payload;
    const refund: RefundEvent = {
      messageId: `refund-event-${suffix}`,
      operationId: command.operationId,
      type: 'billing.payment-refunded.v1',
      producer: 'soat-billing-service',
      osId: os2,
      sagaId: saga2,
      filialId: 'branch',
      correlationId: 'c1',
      data: {
        refundId: command.data.refundId,
        paymentId,
        chargeId,
        quoteId,
        quoteVersion: 1,
        amountInCents: 500,
        currency: 'BRL',
        providerOrderId: 'order1',
        providerRefundId: 'refund1',
        cancelOperationId: cancelOp,
      },
    };
    const blocked: FailureEvent = {
      messageId: `blocked-${suffix}`,
      operationId: command.operationId,
      causationId: command.messageId,
      type: 'billing.refund-blocked.v1',
      producer: 'soat-billing-service',
      osId: os2,
      sagaId: saga2,
      filialId: 'branch',
      correlationId: 'c1',
      data: {
        ...command.data,
        reasonCode:
          mode === 'evidência divergente'
            ? 'EVIDENCE_MISMATCH'
            : 'PROVIDER_RESULT_UNKNOWN',
      },
    };
    if (mode !== 'normal') {
      expect(await new ReceiveFailureEvent(db).execute(blocked)).toBe(
        'APPLIED',
      );
      if (mode === 'aviso divergente subsequente')
        expect(
          await new ReceiveFailureEvent(db).execute({
            ...blocked,
            messageId: `${blocked.messageId}-mismatch`,
            data: { ...blocked.data, reasonCode: 'EVIDENCE_MISMATCH' },
          }),
        ).toBe('APPLIED');
      if (mode === 'conflito físico')
        await db.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES ('os.saga-events', ${`work-${suffix}`}, ${`work-op-${suffix}`}, 'execution.work-started.v1', ${JSON.stringify({ sagaId: saga2 })}::jsonb, 'PENDING')`;
      if (mode === 'cancelamento conflitante')
        await db.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES ('os.saga-events', ${`other-cancel-${suffix}`}, ${`other-cancel-op-${suffix}`}, 'execution.work-cancelled.v1', ${JSON.stringify({ sagaId: saga2, data: { outcome: 'ALREADY_STARTED' } })}::jsonb, 'PENDING')`;
    }
    await expect(
      new ReceiveRefundEvent(db).execute({
        ...refund,
        data: { ...refund.data, amountInCents: 999 },
      }),
    ).rejects.toThrow('Pagamento não corresponde');
    const outcome = await new ReceiveRefundEvent(db).execute(refund);
    if (
      mode === 'conflito físico' ||
      mode === 'cancelamento conflitante' ||
      mode === 'aviso divergente subsequente' ||
      mode === 'evidência divergente'
    ) {
      expect(outcome).toBe('PENDING');
      const blockedRelease = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*) AS count FROM "Outbox" WHERE "type"='execution.release-parts.v1' AND "payload"->>'sagaId'=${saga2}`;
      expect(blockedRelease[0].count).toBe(0n);
      return;
    }
    expect(outcome).toBe('APPLIED');
    if (mode === 'normal')
      expect(await new ReceiveFailureEvent(db).execute(blocked)).toBe(
        'APPLIED',
      );
    if (mode === 'resultado incerto') {
      const audits = await db.$queryRaw<
        Array<{ reason: string }>
      >`SELECT "reason" FROM "SagaRecoveryAudit" WHERE "sagaId"=${saga2}`;
      expect(audits).toContainEqual({
        reason: 'AUTHENTICATED_REFUND_CONFIRMED',
      });
    }
    const release = await db.$queryRaw<
      Array<{ payload: { operationId: string; data: ReleaseEvent['data'] } }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'execution.release-parts.v1' AND "payload"->>'sagaId' = ${saga2}`;
    expect(release).toHaveLength(1);
    expect(release[0].payload.data.reservationId).toBe(reservationId);
    const released: ReleaseEvent = {
      messageId: `released-${suffix}`,
      operationId: release[0].payload.operationId,
      type: 'execution.parts-released.v1',
      producer: 'soat-execution-service',
      osId: os2,
      sagaId: saga2,
      filialId: 'branch',
      data: { ...release[0].payload.data, outcome: 'RELEASED' },
    };
    const receiver = new ReceiveReleaseEvent(db);
    expect(
      await Promise.all([
        receiver.execute(released),
        receiver.execute(released),
      ]),
    ).toEqual(['APPLIED', 'APPLIED']);
    const status = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${saga2}`;
    expect(status[0].status).toBe('COMPENSADA');
  });
});
