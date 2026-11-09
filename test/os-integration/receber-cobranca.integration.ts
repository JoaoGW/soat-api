import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import {
  ChargeEventConsumer,
  chargeEventValidator,
} from '../../src/infrastructure/service-bus/ChargeEventConsumer';
import { PrismaClient } from '@prisma/client';
import { ReceiveChargeEvent } from '../../src/infrastructure/saga/ReceberCobranca';
import { ReplayPendingChargeEvents } from '../../src/infrastructure/saga/ReaplicarCobrancas';
import { SagaReplayWorker } from '../../src/infrastructure/saga/AgendarReaplicacao';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL de teste é obrigatória');
const target = new URL(url);
if (
  !['localhost', '127.0.0.1', '::1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local com nome terminado em _test');

describe('recepção de cobrança na Saga em PostgreSQL', () => {
  const prisma = new PrismaClient();
  const service = new ReceiveChargeEvent(prisma);
  const prefix = randomUUID();
  const client = `client-${prefix}`;
  const vehicle = `vehicle-${prefix}`;
  beforeAll(async () => {
    const document = String(
      BigInt('0x' + prefix.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
    const plate = prefix.slice(0, 7).toUpperCase();
    await prisma.$executeRaw`INSERT INTO "Cliente" ("id", "nome", "documento", "tipo", "contato", "updatedAt") VALUES (${client}, 'Teste', ${document}, 'PF', 'test', NOW())`;
    await prisma.$executeRaw`INSERT INTO "Veiculo" ("id", "clienteId", "placa", "marca", "modelo", "ano", "updatedAt") VALUES (${vehicle}, ${client}, ${plate}, 'X', 'Y', 2020, NOW())`;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  async function setup(status = 'COBRANCA_PENDENTE') {
    const id = randomUUID();
    const osId = `os-${id}`;
    const sagaId = `saga-${id}`;
    const operationId = `op-${id}`;
    const data = {
      quoteId: `quote-${id}`,
      quoteVersion: 1,
      chargeId: `charge-${id}`,
      clientId: client,
      totalInCents: 5000,
      currency: 'BRL',
      reservationId: `reservation-${id}`,
      expiresAt: '2030-01-01T00:15:00Z',
    };
    const command = {
      type: 'billing.create-charge.v1',
      operationId,
      sagaId,
      data,
    };
    const event = {
      messageId: `message-${id}`,
      type: 'billing.charge-created.v1' as const,
      producer: 'soat-billing-service' as const,
      operationId,
      sagaId,
      osId,
      filialId: 'branch',
      data: {
        ...data,
        providerOrderId: `ORD${'A'.repeat(26)}`,
        externalReference: data.chargeId,
        expiresAt: '2030-01-01T00:15:00.000Z',
      },
    };
    await prisma.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${osId}, ${id}, ${client}, ${vehicle}, 'branch', 'ABERTA', NOW())`;
    await prisma.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "quoteId", "quoteVersion", "updatedAt") VALUES (${sagaId}, ${osId}, 'branch', ${status}, ${data.quoteId}, 1, NOW())`;
    await prisma.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${sagaId}, 'CHARGE', 1, 'billing.create-charge.v1', 'SENT', NOW())`;
    await prisma.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${`command-${id}`}, 'billing.create-charge.v1', ${JSON.stringify(command)}::jsonb)`;
    return event;
  }
  it('grava inbox e muda Saga apenas uma vez mesmo em entregas concorrentes', async () => {
    const event = await setup();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.execute(event)),
    );
    expect(results).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED']);
    const rows = await prisma.$queryRaw<
      Array<{ status: string; version: number; chargeId: string }>
    >`SELECT "status", "version", "chargeId" FROM "SagaInstance" WHERE "id" = ${event.sagaId}`;
    expect(rows[0]).toEqual({
      status: 'AGUARDANDO_PAGAMENTO',
      version: 1,
      chargeId: event.data.chargeId,
    });
    const inbox = await prisma.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "Inbox" WHERE "messageId" = ${event.messageId}`;
    expect(inbox).toEqual([{ status: 'APPLIED' }]);
    await expect(
      service.execute({ ...event, messageId: `again-${event.messageId}` }),
    ).resolves.toBe('APPLIED');
    await expect(
      service.execute({ ...event, data: { ...event.data, totalInCents: 1 } }),
    ).rejects.toThrow('diverge');
  });
  it('mantém evento fora de ordem pendente e o reaplica quando a etapa estiver pronta', async () => {
    const event = await setup('RESERVA_PENDENTE');
    await expect(service.execute(event)).resolves.toBe('PENDING');
    await prisma.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COBRANCA_PENDENTE' WHERE "id" = ${event.sagaId}`;
    await expect(service.execute(event)).resolves.toBe('APPLIED');
  });
  it('não avança quando a operação foi cancelada ou evento é de falha', async () => {
    const event = await setup();
    await prisma.$executeRaw`UPDATE "SagaOperation" SET "status" = 'CANCELLED' WHERE "operationId" = ${event.operationId}`;
    await expect(service.execute(event)).resolves.toBe('PENDING');
    const failed = {
      ...event,
      messageId: `failed-${event.messageId}`,
      type: 'billing.charge-failed.v1' as const,
      data: { ...event.data, reasonCode: 'EXPIRED' },
    };
    await expect(service.execute(failed)).resolves.toBe('PENDING');
    const rows = await prisma.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${event.sagaId}`;
    expect(rows[0].status).toBe('COBRANCA_PENDENTE');
  });
  it('reverte inbox e transição se a operação não puder ser atualizada', async () => {
    const event = await setup();
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION test_block_saga_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha'; END; $$ LANGUAGE plpgsql",
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER test_block_saga_update BEFORE UPDATE ON "SagaOperation" FOR EACH ROW EXECUTE FUNCTION test_block_saga_update()',
    );
    try {
      await expect(service.execute(event)).rejects.toThrow();
      const inbox = await prisma.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*)::bigint AS count FROM "Inbox" WHERE "messageId" = ${event.messageId}`;
      expect(inbox[0].count).toBe(0n);
      const rows = await prisma.$queryRaw<
        Array<{ status: string; version: number }>
      >`SELECT "status", "version" FROM "SagaInstance" WHERE "id" = ${event.sagaId}`;
      expect(rows[0]).toEqual({ status: 'COBRANCA_PENDENTE', version: 0 });
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER test_block_saga_update ON "SagaOperation"',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION test_block_saga_update()');
    }
  });
  it('valida e confirma evento somente após inbox e Saga persistirem', async () => {
    const event = await setup();
    const dir = resolve(process.cwd(), 'docs/contracts/messages');
    const fixture = JSON.parse(
      readFileSync(
        resolve(dir, 'examples/billing.charge-created.v1.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const body = { ...fixture, ...event };
    const message = {
      messageId: event.messageId,
      subject: event.type,
      body,
    } as ServiceBusReceivedMessage;
    const receiver = {
      completeMessage: jest.fn(),
      abandonMessage: jest.fn(),
      deadLetterMessage: jest.fn(),
    };
    const consumer = new ChargeEventConsumer(
      service,
      chargeEventValidator(dir),
    );
    await consumer.process(message, receiver as unknown as ServiceBusReceiver);
    expect(receiver.completeMessage).toHaveBeenCalledWith(message);
    expect(receiver.abandonMessage).not.toHaveBeenCalled();
    const result = await prisma.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "Inbox" WHERE "messageId" = ${event.messageId}`;
    expect(result[0].status).toBe('APPLIED');
  });
  it('varre páginas de eventos pendentes sem depender de redelivery', async () => {
    const event = await setup('RESERVA_PENDENTE');
    const dir = resolve(process.cwd(), 'docs/contracts/messages');
    const fixture = JSON.parse(
      readFileSync(
        resolve(dir, 'examples/billing.charge-created.v1.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const body = { ...fixture, ...event };
    const message = {
      messageId: event.messageId,
      subject: event.type,
      body,
    } as ServiceBusReceivedMessage;
    const receiver = {
      completeMessage: jest.fn(),
      abandonMessage: jest.fn(),
      deadLetterMessage: jest.fn(),
    };
    const validator = chargeEventValidator(dir);
    const consumer = new ChargeEventConsumer(service, validator);
    await consumer.process(message, receiver as unknown as ServiceBusReceiver);
    expect(receiver.completeMessage).toHaveBeenCalled();
    await prisma.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COBRANCA_PENDENTE' WHERE "id" = ${event.sagaId}`;
    const replay = new ReplayPendingChargeEvents(prisma, service, validator);
    let cursor: { receivedAt: Date; messageId: string } | undefined;
    for (let i = 0; i < 100; i++) {
      const page = await replay.execute(1, cursor);
      if (!page.next) break;
      cursor = page.next;
    }
    const rows = await prisma.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "Inbox" WHERE "messageId" = ${event.messageId}`;
    expect(rows[0].status).toBe('APPLIED');
  });
  it('agendador opcional reaplica evento no banco dedicado', async () => {
    const event = await setup('RESERVA_PENDENTE');
    const dir = resolve(process.cwd(), 'docs/contracts/messages');
    const fixture = JSON.parse(
      readFileSync(
        resolve(dir, 'examples/billing.charge-created.v1.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const message = {
      messageId: event.messageId,
      subject: event.type,
      body: { ...fixture, ...event },
    } as ServiceBusReceivedMessage;
    const receiver = {
      completeMessage: jest.fn(),
      abandonMessage: jest.fn(),
      deadLetterMessage: jest.fn(),
    };
    await new ChargeEventConsumer(service, chargeEventValidator(dir)).process(
      message,
      receiver as unknown as ServiceBusReceiver,
    );
    await prisma.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COBRANCA_PENDENTE' WHERE "id" = ${event.sagaId}`;
    const previousEnabled = process.env.ENABLE_SAGA_REPLAY;
    const previousUrl = process.env.SAGA_DATABASE_URL;
    process.env.ENABLE_SAGA_REPLAY = 'true';
    process.env.SAGA_DATABASE_URL = url;
    const worker = new SagaReplayWorker();
    try {
      worker.onModuleInit();
      let status = '';
      for (let i = 0; i < 100 && status !== 'APPLIED'; i++) {
        const rows = await prisma.$queryRaw<
          Array<{ status: string }>
        >`SELECT "status" FROM "Inbox" WHERE "messageId" = ${event.messageId}`;
        status = rows[0]?.status;
        if (status !== 'APPLIED')
          await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(status).toBe('APPLIED');
    } finally {
      await worker.onApplicationShutdown();
      if (previousEnabled === undefined) delete process.env.ENABLE_SAGA_REPLAY;
      else process.env.ENABLE_SAGA_REPLAY = previousEnabled;
      if (previousUrl === undefined) delete process.env.SAGA_DATABASE_URL;
      else process.env.SAGA_DATABASE_URL = previousUrl;
    }
  });
});
