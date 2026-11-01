import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { PrismaClient } from '@prisma/client';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import {
  PaymentEventConsumer,
  paymentEventValidator,
} from '../../src/infrastructure/service-bus/PaymentEventConsumer';
import { chargeEventValidator } from '../../src/infrastructure/service-bus/ChargeEventConsumer';
import {
  WorkEnqueuedEventConsumer,
  workEnqueuedEventValidator,
} from '../../src/infrastructure/service-bus/WorkEnqueuedEventConsumer';
import { ReplayPendingChargeEvents } from '../../src/infrastructure/saga/ReaplicarCobrancas';
import { ReceivePaymentEvent } from '../../src/infrastructure/saga/ReceberPagamento';
import { ReceiveWorkEnqueuedEvent } from '../../src/infrastructure/saga/ReceberEnfileiramento';
import { ReceiveChargeEvent } from '../../src/infrastructure/saga/ReceberCobranca';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL de teste é obrigatória');
const target = new URL(url);
if (
  !['localhost', '127.0.0.1', '::1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local com nome terminado em _test');

describe('pagamento e autorização da fila em PostgreSQL', () => {
  const db = new PrismaClient();
  const paymentService = new ReceivePaymentEvent(db);
  const chargeService = new ReceiveChargeEvent(db);
  const prefix = randomUUID();
  const client = `client-${prefix}`;
  const vehicle = `vehicle-${prefix}`;
  beforeAll(async () => {
    const document = String(
      BigInt('0x' + prefix.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
    const plate = prefix.slice(0, 7).toUpperCase();
    await db.$executeRaw`INSERT INTO "Cliente" ("id", "nome", "documento", "tipo", "contato", "updatedAt") VALUES (${client}, 'Teste', ${document}, 'PF', 'test', NOW())`;
    await db.$executeRaw`INSERT INTO "Veiculo" ("id", "clienteId", "placa", "marca", "modelo", "ano", "updatedAt") VALUES (${vehicle}, ${client}, ${plate}, 'X', 'Y', 2020, NOW())`;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  async function setup(status = 'COBRANCA_PENDENTE', reserve = true) {
    const id = randomUUID();
    const osId = `os-${id}`;
    const sagaId = `saga-${id}`;
    const operationId = `charge-op-${id}`;
    const quoteId = `quote-${id}`;
    const chargeId = `charge-${id}`;
    const reservationId = `reservation-${id}`;
    const providerOrderId = `ORD${randomUUID().replaceAll('-', '').slice(0, 26)}`;
    const data = {
      quoteId,
      quoteVersion: 1,
      chargeId,
      clientId: client,
      totalInCents: 5001,
      currency: 'BRL',
      reservationId,
      expiresAt: '2030-01-01T00:15:00Z',
    };
    const command = {
      type: 'billing.create-charge.v1',
      operationId,
      sagaId,
      data,
    };
    const chargeEvent = {
      messageId: `charge-msg-${id}`,
      type: 'billing.charge-created.v1' as const,
      producer: 'soat-billing-service' as const,
      operationId,
      sagaId,
      osId,
      filialId: 'branch',
      data: { ...data, providerOrderId, externalReference: chargeId },
    };
    const paymentEvent = {
      messageId: `payment-msg-${id}`,
      type: 'billing.payment-confirmed.v1' as const,
      producer: 'soat-billing-service' as const,
      operationId,
      sagaId,
      osId,
      filialId: 'branch',
      correlationId: `corr-${id}`,
      data: {
        quoteId,
        quoteVersion: 1,
        chargeId,
        paymentId: `payment-${id}`,
        providerOrderId,
        providerPaymentId: '12345',
        amountInCents: 5001,
        currency: 'BRL',
        paidAt: '2030-01-01T00:02:00Z',
      },
    };
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${osId}, ${id}, ${client}, ${vehicle}, 'branch', 'ABERTA', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "quoteId", "quoteVersion", "reservationId", "updatedAt") VALUES (${sagaId}, ${osId}, 'branch', ${status}, ${quoteId}, 1, ${reservationId}, NOW())`;
    await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${sagaId}, 'CHARGE', 1, 'billing.create-charge.v1', 'SENT', NOW())`;
    if (reserve)
      await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "result", "updatedAt") VALUES (${`reserve-op-${id}`}, ${sagaId}, 'RESERVE', 1, 'execution.reserve-parts.v1', 'SUCCEEDED', ${JSON.stringify({ data: { quoteId, quoteVersion: 1, reservationId } })}::jsonb, NOW())`;
    await db.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${`command-${id}`}, 'billing.create-charge.v1', ${JSON.stringify(command)}::jsonb)`;
    return { paymentEvent, chargeEvent };
  }
  it('guarda pagamento antecipado e autoriza fila uma única vez após cobrança', async () => {
    const { paymentEvent, chargeEvent } = await setup();
    await expect(paymentService.execute(paymentEvent)).resolves.toBe('PENDING');
    await expect(chargeService.execute(chargeEvent)).resolves.toBe('APPLIED');
    expect(
      await Promise.all(
        Array.from({ length: 4 }, () => paymentService.execute(paymentEvent)),
      ),
    ).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED']);
    const events = await db.$queryRaw<
      Array<{ payload: unknown }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'execution.enqueue-work.v1' AND "payload"->>'sagaId' = ${paymentEvent.sagaId}`;
    expect(events).toHaveLength(1);
    const dir = resolve(process.cwd(), 'docs/contracts/messages');
    const ajv = new Ajv();
    addFormats(ajv);
    ajv.addSchema(
      JSON.parse(readFileSync(resolve(dir, 'envelope.schema.json'), 'utf8')),
    );
    expect(
      ajv.validate(
        JSON.parse(
          readFileSync(
            resolve(dir, 'execution.enqueue-work.v1.schema.json'),
            'utf8',
          ),
        ),
        events[0].payload,
      ),
    ).toBe(true);
    const rows = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${paymentEvent.sagaId}`;
    expect(rows[0].status).toBe('FILA_PENDENTE');
    await expect(
      paymentService.execute({
        ...paymentEvent,
        messageId: `retry-${paymentEvent.messageId}`,
      }),
    ).resolves.toBe('APPLIED');
  });
  it('não enfileira sem reserva confirmada', async () => {
    const { paymentEvent, chargeEvent } = await setup(
      'COBRANCA_PENDENTE',
      false,
    );
    await chargeService.execute(chargeEvent);
    await expect(paymentService.execute(paymentEvent)).resolves.toBe('PENDING');
    const rows = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${paymentEvent.sagaId}`;
    expect(rows[0].status).toBe('AGUARDANDO_PAGAMENTO');
  });
  it('pagamento tardio após cancelamento exige reconciliação e não autoriza fila', async () => {
    const { paymentEvent } = await setup('COMPENSANDO');
    await expect(paymentService.execute(paymentEvent)).resolves.toBe('APPLIED');
    const rows = await db.$queryRaw<
      Array<{ status: string; requiresAttention: boolean }>
    >`SELECT "status", "requiresAttention" FROM "SagaInstance" WHERE "id" = ${paymentEvent.sagaId}`;
    expect(rows[0]).toEqual({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
    });
    const events = await db.$queryRaw<
      Array<{ messageId: string }>
    >`SELECT "messageId" FROM "Outbox" WHERE "type" = 'execution.enqueue-work.v1' AND "payload"->>'sagaId' = ${paymentEvent.sagaId}`;
    expect(events).toHaveLength(0);
  });
  it('reverte inbox, estado e operação quando falha a outbox', async () => {
    const { paymentEvent, chargeEvent } = await setup();
    await chargeService.execute(chargeEvent);
    await db.$executeRawUnsafe(
      "CREATE FUNCTION test_block_enqueue() RETURNS trigger AS $$ BEGIN IF NEW.type = 'execution.enqueue-work.v1' THEN RAISE EXCEPTION 'outbox offline'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER test_block_enqueue BEFORE INSERT ON "Outbox" FOR EACH ROW EXECUTE FUNCTION test_block_enqueue()',
    );
    try {
      await expect(paymentService.execute(paymentEvent)).rejects.toThrow();
      const inbox = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*)::bigint AS count FROM "Inbox" WHERE "messageId" = ${paymentEvent.messageId}`;
      expect(inbox[0].count).toBe(0n);
      const rows = await db.$queryRaw<
        Array<{ status: string }>
      >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${paymentEvent.sagaId}`;
      expect(rows[0].status).toBe('AGUARDANDO_PAGAMENTO');
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_block_enqueue ON "Outbox"');
      await db.$executeRawUnsafe('DROP FUNCTION test_block_enqueue()');
    }
  });
  it('ACK de pagamento antecipado permite reaplicação posterior pelo agendador', async () => {
    const { paymentEvent, chargeEvent } = await setup();
    const dir = resolve(process.cwd(), 'docs/contracts/messages');
    const fixture = JSON.parse(
      readFileSync(
        resolve(dir, 'examples/billing.payment-confirmed.v1.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const message = {
      messageId: paymentEvent.messageId,
      subject: paymentEvent.type,
      body: { ...fixture, ...paymentEvent },
    } as ServiceBusReceivedMessage;
    const receiver = {
      completeMessage: jest.fn(),
      abandonMessage: jest.fn(),
      deadLetterMessage: jest.fn(),
    };
    const validator = paymentEventValidator(dir);
    await new PaymentEventConsumer(paymentService, validator).process(
      message,
      receiver as unknown as ServiceBusReceiver,
    );
    expect(receiver.completeMessage).toHaveBeenCalledWith(message);
    await chargeService.execute(chargeEvent);
    const replay = new ReplayPendingChargeEvents(
      db,
      chargeService,
      chargeEventValidator(dir),
      paymentService,
      validator,
    );
    let cursor: { receivedAt: Date; messageId: string } | undefined;
    for (let i = 0; i < 100; i++) {
      const page = await replay.execute(1, cursor);
      if (!page.next) break;
      cursor = page.next;
    }
    const rows = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "Inbox" WHERE "messageId" = ${paymentEvent.messageId}`;
    expect(rows[0].status).toBe('APPLIED');
    const events = await db.$queryRaw<
      Array<{ messageId: string }>
    >`SELECT "messageId" FROM "Outbox" WHERE "type" = 'execution.enqueue-work.v1' AND "payload"->>'sagaId' = ${paymentEvent.sagaId}`;
    expect(events).toHaveLength(1);
  });
  it('order diferente da cobrança registrada exige reconciliação', async () => {
    const { paymentEvent, chargeEvent } = await setup();
    await chargeService.execute(chargeEvent);
    const divergent = {
      ...paymentEvent,
      data: { ...paymentEvent.data, providerOrderId: `ORD${'B'.repeat(26)}` },
    };
    await expect(paymentService.execute(divergent)).resolves.toBe('APPLIED');
    const rows = await db.$queryRaw<
      Array<{ status: string; requiresAttention: boolean }>
    >`SELECT "status", "requiresAttention" FROM "SagaInstance" WHERE "id" = ${paymentEvent.sagaId}`;
    expect(rows[0]).toEqual({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
    });
    const events = await db.$queryRaw<
      Array<{ messageId: string }>
    >`SELECT "messageId" FROM "Outbox" WHERE "type" = 'execution.enqueue-work.v1' AND "payload"->>'sagaId' = ${paymentEvent.sagaId}`;
    expect(events).toHaveLength(0);
  });
  it('confirma fila apenas para operação e reserva correspondentes', async () => {
    const { paymentEvent, chargeEvent } = await setup();
    await chargeService.execute(chargeEvent);
    await paymentService.execute(paymentEvent);
    const commands = await db.$queryRaw<
      Array<{
        payload: {
          operationId: string;
          data: {
            executionId: string;
            reservationId: string;
            quoteId: string;
            quoteVersion: number;
            chargeId: string;
            paymentId: string;
          };
        };
      }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'execution.enqueue-work.v1' AND "payload"->>'sagaId' = ${paymentEvent.sagaId}`;
    const command = commands[0].payload;
    const event = {
      messageId: `work-${paymentEvent.messageId}`,
      type: 'execution.work-enqueued.v1' as const,
      producer: 'soat-execution-service' as const,
      operationId: command.operationId,
      sagaId: paymentEvent.sagaId,
      osId: paymentEvent.osId,
      filialId: paymentEvent.filialId,
      data: command.data,
    };
    const handler = new ReceiveWorkEnqueuedEvent(db);
    expect(
      await Promise.all(
        Array.from({ length: 4 }, () => handler.execute(event)),
      ),
    ).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED']);
    const saga = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${paymentEvent.sagaId}`;
    expect(saga[0].status).toBe('NA_FILA');
    await expect(
      handler.execute({ ...event, messageId: `again-${event.messageId}` }),
    ).resolves.toBe('APPLIED');
    await expect(
      handler.execute({
        ...event,
        messageId: `bad-${event.messageId}`,
        data: { ...event.data, reservationId: 'other' },
      }),
    ).rejects.toThrow('diverge');
  });
  it('não avança fila depois de iniciar compensação', async () => {
    const { paymentEvent, chargeEvent } = await setup();
    await chargeService.execute(chargeEvent);
    await paymentService.execute(paymentEvent);
    const commands = await db.$queryRaw<
      Array<{
        payload: {
          operationId: string;
          data: {
            executionId: string;
            reservationId: string;
            quoteId: string;
            quoteVersion: number;
            chargeId: string;
            paymentId: string;
          };
        };
      }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'execution.enqueue-work.v1' AND "payload"->>'sagaId' = ${paymentEvent.sagaId}`;
    const command = commands[0].payload;
    await db.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COMPENSANDO' WHERE "id" = ${paymentEvent.sagaId}`;
    const event = {
      messageId: `late-${paymentEvent.messageId}`,
      type: 'execution.work-enqueued.v1' as const,
      producer: 'soat-execution-service' as const,
      operationId: command.operationId,
      sagaId: paymentEvent.sagaId,
      osId: paymentEvent.osId,
      filialId: paymentEvent.filialId,
      data: command.data,
    };
    await expect(new ReceiveWorkEnqueuedEvent(db).execute(event)).resolves.toBe(
      'PENDING',
    );
    const rows = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${paymentEvent.sagaId}`;
    expect(rows[0].status).toBe('COMPENSANDO');
  });
  it('reaplica confirmação de fila recebida antes da etapa correta', async () => {
    const { paymentEvent, chargeEvent } = await setup();
    await chargeService.execute(chargeEvent);
    await paymentService.execute(paymentEvent);
    const commands = await db.$queryRaw<
      Array<{
        payload: {
          operationId: string;
          data: {
            executionId: string;
            reservationId: string;
            quoteId: string;
            quoteVersion: number;
            chargeId: string;
            paymentId: string;
          };
        };
      }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'execution.enqueue-work.v1' AND "payload"->>'sagaId' = ${paymentEvent.sagaId}`;
    const command = commands[0].payload;
    const dir = resolve(process.cwd(), 'docs/contracts/messages');
    const fixture = JSON.parse(
      readFileSync(
        resolve(dir, 'examples/execution.work-enqueued.v1.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const event = {
      ...fixture,
      messageId: `queued-${paymentEvent.messageId}`,
      type: 'execution.work-enqueued.v1' as const,
      producer: 'soat-execution-service' as const,
      operationId: command.operationId,
      sagaId: paymentEvent.sagaId,
      osId: paymentEvent.osId,
      filialId: paymentEvent.filialId,
      data: command.data,
    };
    const message = {
      messageId: event.messageId,
      subject: event.type,
      body: event,
    } as ServiceBusReceivedMessage;
    const receiver = {
      completeMessage: jest.fn(),
      abandonMessage: jest.fn(),
      deadLetterMessage: jest.fn(),
    };
    const workHandler = new ReceiveWorkEnqueuedEvent(db);
    const workValidator = workEnqueuedEventValidator(dir);
    await db.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COBRANCA_PENDENTE' WHERE "id" = ${paymentEvent.sagaId}`;
    await new WorkEnqueuedEventConsumer(workHandler, workValidator).process(
      message,
      receiver as unknown as ServiceBusReceiver,
    );
    expect(receiver.completeMessage).toHaveBeenCalledWith(message);
    await db.$executeRaw`UPDATE "SagaInstance" SET "status" = 'FILA_PENDENTE' WHERE "id" = ${paymentEvent.sagaId}`;
    const replay = new ReplayPendingChargeEvents(
      db,
      chargeService,
      chargeEventValidator(dir),
      paymentService,
      paymentEventValidator(dir),
      workHandler,
      workValidator,
    );
    let cursor: { receivedAt: Date; messageId: string } | undefined;
    for (let i = 0; i < 100; i++) {
      const page = await replay.execute(1, cursor);
      if (!page.next) break;
      cursor = page.next;
    }
    const rows = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "Inbox" WHERE "messageId" = ${event.messageId}`;
    expect(rows[0].status).toBe('APPLIED');
  });
});
