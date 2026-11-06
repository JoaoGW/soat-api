import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ReviewSagaDeadlines } from '../../src/infrastructure/saga/RevisarPrazos';
import {
  ReceiveCancellationEvent,
  CancellationEvent,
} from '../../src/infrastructure/saga/ReceberCancelamento';
import {
  ReceiveFailureEvent,
  FailureEvent,
} from '../../src/infrastructure/saga/ReceberFalha';
const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('Banco local de teste obrigatório');
describe('falhas definitivas da Saga', () => {
  const db = new PrismaClient();
  const handler = new ReceiveFailureEvent(db);
  const prefix = randomUUID();
  const client = `client-${prefix}`;
  const vehicle = `vehicle-${prefix}`;
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
  async function setup(
    kind: 'quote' | 'reservation' | 'charge',
    ambiguous = false,
  ) {
    const id = randomUUID();
    const sagaId = `saga-${id}`;
    const osId = `os-${id}`;
    const operationId = `op-${id}`;
    const quoteId = `quote-${id}`;
    const reservationId = `res-${id}`;
    const chargeId = `charge-${id}`;
    const map = {
      quote: [
        'ORCAMENTO_PENDENTE',
        'billing.generate-quote.v1',
        'billing.quote-failed.v1',
        'soat-billing-service',
      ],
      reservation: [
        'RESERVA_PENDENTE',
        'execution.reserve-parts.v1',
        'execution.parts-reservation-failed.v1',
        'soat-execution-service',
      ],
      charge: [
        'COBRANCA_PENDENTE',
        'billing.create-charge.v1',
        'billing.charge-failed.v1',
        'soat-billing-service',
      ],
    } as const;
    const [state, commandType, type, producer] = map[kind];
    const data =
      kind === 'quote'
        ? {
            diagnosisId: osId,
            diagnosisVersion: 3,
            reasonCode: ambiguous ? 'ALREADY_EXISTS' : 'EXPIRED',
          }
        : kind === 'reservation'
          ? {
              quoteId,
              quoteVersion: 1,
              reservationId,
              reason: 'INSUFFICIENT_STOCK',
            }
          : {
              quoteId,
              quoteVersion: 1,
              reservationId,
              chargeId,
              reasonCode: 'EXPIRED',
            };
    const payload = { operationId, sagaId, data };
    const event: FailureEvent = {
      messageId: `msg-${id}`,
      operationId,
      sagaId,
      osId,
      filialId: 'f1',
      correlationId: id,
      type,
      producer,
      data,
    };
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${osId}, ${id}, ${client}, ${vehicle}, 'f1', 'RECEBIDA', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "quoteId", "quoteVersion", "reservationId", "updatedAt") VALUES (${sagaId}, ${osId}, 'f1', ${state}, ${quoteId}, 1, ${reservationId}, NOW())`;
    await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${sagaId}, 'TEST_FAILURE', 1, ${commandType}, 'PENDING', NOW())`;
    await db.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${`command-${id}`}, ${commandType}, ${JSON.stringify(payload)}::jsonb)`;
    return event;
  }
  it('envia a Saga à reconciliação quando Billing bloqueia reembolso por evidência divergente', async () => {
    const base = await setup('charge');
    const data = {
      refundId: `refund-${base.operationId}`,
      paymentId: `payment-${base.operationId}`,
      cancelOperationId: `cancel-${base.operationId}`,
      cancelEventId: `event-${base.operationId}`,
      reasonCode: 'EVIDENCE_MISMATCH',
    };
    const commandMessageId = base.messageId.replace('msg-', 'command-');
    const event: FailureEvent = {
      ...base,
      type: 'billing.refund-blocked.v1',
      data,
      causationId: commandMessageId,
    };
    await db.$executeRaw`UPDATE "SagaInstance" SET "status"='REEMBOLSO_PENDENTE' WHERE "id"=${base.sagaId}`;
    await db.$executeRaw`UPDATE "SagaOperation" SET "commandType"='billing.refund-payment.v1' WHERE "operationId"=${base.operationId}`;
    await db.$executeRaw`UPDATE "Outbox" SET "type"='billing.refund-payment.v1', "payload"=${JSON.stringify({ messageId: commandMessageId, operationId: base.operationId, sagaId: base.sagaId, data })}::jsonb WHERE "payload"->>'operationId'=${base.operationId}`;
    await expect(
      handler.execute({ ...event, causationId: 'other' }),
    ).rejects.toThrow('diverge');
    await expect(
      handler.execute({ ...event, data: { ...data, paymentId: 'other' } }),
    ).rejects.toThrow('diverge');
    expect(
      await Promise.all([handler.execute(event), handler.execute(event)]),
    ).toEqual(['APPLIED', 'APPLIED']);
    expect(
      await handler.execute({
        ...event,
        messageId: `${event.messageId}-again`,
      }),
    ).toBe('APPLIED');
    const rows = await db.$queryRaw<
      Array<{
        status: string;
        requiresAttention: boolean;
        lastError: string;
        version: number;
      }>
    >`SELECT "status", "requiresAttention", "lastError", "version" FROM "SagaInstance" WHERE "id"=${base.sagaId}`;
    expect(rows[0]).toMatchObject({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
      lastError: 'REFUND_EVIDENCE_MISMATCH',
      version: 1,
    });
    const releases = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) AS count FROM "Outbox" WHERE "type"='execution.release-parts.v1' AND "payload"->>'sagaId'=${base.sagaId}`;
    expect(releases[0].count).toBe(0n);
  });
  it.each(['quote', 'reservation', 'charge'] as const)(
    'compensa a falha definitiva de %s uma vez',
    async (kind) => {
      const event = await setup(kind);
      expect(
        await Promise.all([handler.execute(event), handler.execute(event)]),
      ).toEqual(['APPLIED', 'APPLIED']);
      const state = await db.$queryRaw<
        Array<{ status: string; reservationId: string | null }>
      >`SELECT "status", "reservationId" FROM "SagaInstance" WHERE "id" = ${event.sagaId}`;
      expect(state[0].status).toBe('COMPENSANDO');
      if (kind === 'reservation') expect(state[0].reservationId).toBeNull();
      const commands = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*) AS count FROM "Outbox" WHERE "type" = 'execution.cancel-work.v1' AND "payload"->>'sagaId' = ${event.sagaId}`;
      expect(Number(commands[0].count)).toBe(1);
    },
  );
  it('não presume que orçamento existente pode ser cancelado', async () => {
    const event = await setup('quote', true);
    expect(await handler.execute(event)).toBe('APPLIED');
    const state = await db.$queryRaw<
      Array<{ status: string; requiresAttention: boolean }>
    >`SELECT "status", "requiresAttention" FROM "SagaInstance" WHERE "id" = ${event.sagaId}`;
    expect(state[0]).toEqual({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
    });
  });
  it('libera a reserva somente após falha definitiva e cancelamento confirmado', async () => {
    const event = await setup('charge');
    await handler.execute(event);
    const commands = await db.$queryRaw<
      Array<{ payload: { operationId: string; data: { reason: string } } }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'execution.cancel-work.v1' AND "payload"->>'sagaId' = ${event.sagaId}`;
    const cancelled: CancellationEvent = {
      messageId: randomUUID(),
      operationId: commands[0].payload.operationId,
      osId: event.osId,
      sagaId: event.sagaId,
      filialId: event.filialId,
      type: 'execution.work-cancelled.v1',
      producer: 'soat-execution-service',
      data: { outcome: 'CANCELLED', reason: commands[0].payload.data.reason },
    };
    expect(await new ReceiveCancellationEvent(db).execute(cancelled)).toBe(
      'APPLIED',
    );
    const releases = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) AS count FROM "Outbox" WHERE "type" = 'execution.release-parts.v1' AND "payload"->>'sagaId' = ${event.sagaId}`;
    expect(Number(releases[0].count)).toBe(1);
  });
  it('prazo vencido gera reconciliação sem presumir estado financeiro', async () => {
    const event = await setup('charge');
    await db.$executeRaw`UPDATE "SagaInstance" SET "deadlineAt" = ${new Date('1990-01-01T00:00:00Z')} WHERE "id" = ${event.sagaId}`;
    const review = new ReviewSagaDeadlines(db);
    await Promise.all([
      review.execute(new Date(), 100),
      review.execute(new Date(), 100),
    ]);
    const rows = await db.$queryRaw<
      Array<{ status: string; requiresAttention: boolean; lastError: string }>
    >`SELECT "status", "requiresAttention", "lastError" FROM "SagaInstance" WHERE "id" = ${event.sagaId}`;
    expect(rows[0]).toEqual({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
      lastError: 'DEADLINE_EXPIRED',
    });
    const commands = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) AS count FROM "Outbox" WHERE "type" IN ('execution.release-parts.v1', 'billing.refund-payment.v1') AND "payload"->>'sagaId' = ${event.sagaId}`;
    expect(Number(commands[0].count)).toBe(0);
  });
  it('retoma prazo vencido apenas com falha definitiva de orçamento e registra a evidência', async () => {
    const event = await setup('quote');
    await db.$executeRaw`UPDATE "SagaInstance" SET "quoteId"=NULL, "quoteVersion"=NULL, "reservationId"=NULL, "deadlineAt"=${new Date('1990-01-01T00:00:00Z')} WHERE "id"=${event.sagaId}`;
    await new ReviewSagaDeadlines(db).execute(new Date(), 100);
    expect(await handler.execute(event)).toBe('APPLIED');
    expect(await handler.execute(event)).toBe('APPLIED');
    const rows = await db.$queryRaw<
      Array<{
        status: string;
        requiresAttention: boolean;
        lastError: string | null;
      }>
    >`SELECT "status", "requiresAttention", "lastError" FROM "SagaInstance" WHERE "id"=${event.sagaId}`;
    expect(rows[0]).toEqual({
      status: 'COMPENSANDO',
      requiresAttention: false,
      lastError: null,
    });
    const audit = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM "SagaRecoveryAudit" WHERE "sagaId"=${event.sagaId} AND "messageId"=${event.messageId}`;
    expect(audit[0].count).toBe(1n);
  });
  it('mantém reconciliação se existir evidência conflitante de orçamento emitido', async () => {
    const event = await setup('quote');
    await db.$executeRaw`UPDATE "SagaInstance" SET "quoteId"=NULL, "quoteVersion"=NULL, "reservationId"=NULL, "status"='RECONCILIACAO_NECESSARIA', "requiresAttention"=true, "lastError"='DEADLINE_EXPIRED' WHERE "id"=${event.sagaId}`;
    await db.$executeRaw`INSERT INTO "Inbox" ("consumer","messageId","operationId","type","payload","status") VALUES ('os.saga-events',${randomUUID()},${event.operationId},'billing.quote-issued.v1',${JSON.stringify({ sagaId: event.sagaId })}::jsonb,'PENDING')`;
    expect(await handler.execute(event)).toBe('PENDING');
    const rows = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id"=${event.sagaId}`;
    expect(rows[0].status).toBe('RECONCILIACAO_NECESSARIA');
  });
  it.each(['reservation', 'charge'] as const)(
    'retoma %s após prazo somente com falha definitiva sem conflito',
    async (kind) => {
      const event = await setup(kind);
      await db.$executeRaw`UPDATE "SagaInstance" SET "status"='RECONCILIACAO_NECESSARIA',"requiresAttention"=true,"lastError"='DEADLINE_EXPIRED' WHERE "id"=${event.sagaId}`;
      expect(await handler.execute(event)).toBe('APPLIED');
      expect(await handler.execute(event)).toBe('APPLIED');
      const state = await db.$queryRaw<
        Array<{ status: string; requiresAttention: boolean }>
      >`SELECT "status","requiresAttention" FROM "SagaInstance" WHERE "id"=${event.sagaId}`;
      expect(state[0]).toEqual({
        status: 'COMPENSANDO',
        requiresAttention: false,
      });
      const audit = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) FROM "SagaRecoveryAudit" WHERE "sagaId"=${event.sagaId} AND "messageId"=${event.messageId}`;
      expect(audit[0].count).toBe(1n);
    },
  );
  it.each(['reservation', 'charge'] as const)(
    'não retoma %s se existir fato financeiro conflitante',
    async (kind) => {
      const event = await setup(kind);
      await db.$executeRaw`UPDATE "SagaInstance" SET "status"='RECONCILIACAO_NECESSARIA',"requiresAttention"=true,"lastError"='DEADLINE_EXPIRED' WHERE "id"=${event.sagaId}`;
      await db.$executeRaw`INSERT INTO "Inbox" ("consumer","messageId","operationId","type","payload","status") VALUES ('os.saga-events',${randomUUID()},${event.operationId},'billing.payment-confirmed.v1',${JSON.stringify({ sagaId: event.sagaId })}::jsonb,'PENDING')`;
      expect(await handler.execute(event)).toBe('PENDING');
      const state = await db.$queryRaw<
        Array<{ status: string }>
      >`SELECT "status" FROM "SagaInstance" WHERE "id"=${event.sagaId}`;
      expect(state[0].status).toBe('RECONCILIACAO_NECESSARIA');
    },
  );
});
