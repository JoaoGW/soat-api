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
});
