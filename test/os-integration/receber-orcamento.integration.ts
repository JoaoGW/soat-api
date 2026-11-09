import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ReceiveQuoteEvent,
  QuoteEvent,
} from '../../src/infrastructure/saga/ReceberOrcamento';
import { ReplayPendingChargeEvents } from '../../src/infrastructure/saga/ReaplicarCobrancas';
import {
  ReceiveReservationEvent,
  ReservationEvent,
} from '../../src/infrastructure/saga/ReceberReserva';
const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');
describe('orçamento na Saga', () => {
  const db = new PrismaClient();
  const handler = new ReceiveQuoteEvent(db);
  const id = randomUUID();
  const client = `client-${id}`;
  const vehicle = `vehicle-${id}`;
  const osId = `os-${id}`;
  const sagaId = `saga-${id}`;
  const operation = `quoteop-${id}`;
  const expiresAt = '2030-01-02T00:00:00.000Z';
  const issued: QuoteEvent = {
    messageId: `issued-${id}`,
    operationId: operation,
    type: 'billing.quote-issued.v1',
    producer: 'soat-billing-service',
    osId,
    sagaId,
    filialId: 'branch',
    correlationId: id,
    data: {
      quoteId: `quote-${id}`,
      quoteVersion: 1,
      clientId: client,
      totalInCents: 1000,
      currency: 'BRL',
      expiresAt,
    },
  };
  const approved: QuoteEvent = {
    ...issued,
    messageId: `approved-${id}`,
    operationId: `decision-${id}`,
    type: 'billing.quote-approved.v1',
    data: { quoteId: issued.data.quoteId, quoteVersion: 1, clientId: client },
  };
  beforeAll(async () => {
    const document = String(
      BigInt('0x' + id.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
    await db.$executeRaw`INSERT INTO "Cliente" ("id", "nome", "documento", "tipo", "contato", "updatedAt") VALUES (${client}, 'Teste', ${document}, 'PF', 'test@example.test', NOW())`;
    await db.$executeRaw`INSERT INTO "Veiculo" ("id", "clienteId", "placa", "marca", "modelo", "ano", "updatedAt") VALUES (${vehicle}, ${client}, ${id.slice(0, 7)}, 'X', 'Y', 2020, NOW())`;
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${osId}, ${id}, ${client}, ${vehicle}, 'branch', 'EM_DIAGNOSTICO', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "updatedAt") VALUES (${sagaId}, ${osId}, 'branch', 'ORCAMENTO_PENDENTE', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operation}, ${sagaId}, 'GENERATE_QUOTE', 1, 'billing.generate-quote.v1', 'SENT', NOW())`;
    const payload = {
      operationId: operation,
      sagaId,
      data: {
        clienteId: client,
        expiresAt,
        items: [
          {
            sourceId: 'p1',
            itemType: 'PART',
            quantity: 2,
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
  it('reaplica aprovação antecipada e emite uma única reserva com itens do snapshot', async () => {
    expect(await handler.execute(approved)).toBe('PENDING');
    await expect(
      handler.execute({ ...issued, data: { ...issued.data, totalInCents: 1 } }),
    ).rejects.toThrow('diverge');
    expect(
      await Promise.all([handler.execute(issued), handler.execute(issued)]),
    ).toEqual(['APPLIED', 'APPLIED']);
    const replay = new ReplayPendingChargeEvents(
      db,
      { execute: async () => 'PENDING' },
      () => true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      handler,
      () => true,
    );
    expect((await replay.execute()).applied).toBeGreaterThanOrEqual(1);
    expect(await handler.execute(approved)).toBe('APPLIED');
    const commands = await db.$queryRaw<
      Array<{
        payload: { operationId: string; data: ReservationEvent['data'] };
      }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'execution.reserve-parts.v1' AND "payload"->>'sagaId' = ${sagaId}`;
    expect(commands).toHaveLength(1);
    const directory = resolve(process.cwd(), 'docs/contracts/messages');
    const ajv = new Ajv();
    addFormats(ajv);
    ajv.addSchema(
      JSON.parse(
        readFileSync(resolve(directory, 'envelope.schema.json'), 'utf8'),
      ),
    );
    expect(
      ajv.validate(
        JSON.parse(
          readFileSync(
            resolve(directory, 'execution.reserve-parts.v1.schema.json'),
            'utf8',
          ),
        ),
        commands[0].payload,
      ),
    ).toBe(true);
    expect(commands[0].payload.data.items).toEqual([
      { sku: 'p1', quantity: 2 },
    ]);
    const state = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${sagaId}`;
    expect(state[0].status).toBe('RESERVA_PENDENTE');
    const reservation: ReservationEvent = {
      messageId: `reserved-${id}`,
      operationId: commands[0].payload.operationId,
      type: 'execution.parts-reserved.v1',
      producer: 'soat-execution-service',
      osId,
      sagaId,
      filialId: 'branch',
      correlationId: id,
      data: commands[0].payload.data,
    };
    expect(
      await new ReceiveReservationEvent(db, undefined).execute(reservation),
    ).toBe('PENDING');
    const receiveReservation = new ReceiveReservationEvent(db, 'pos-001');
    expect(
      await Promise.all([
        receiveReservation.execute(reservation),
        receiveReservation.execute(reservation),
      ]),
    ).toEqual(['APPLIED', 'APPLIED']);
    const charges = await db.$queryRaw<
      Array<{
        payload: { data: { totalInCents: number; externalPosId: string } };
      }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'billing.create-charge.v1' AND "payload"->>'sagaId' = ${sagaId}`;
    expect(charges).toHaveLength(1);
    expect(
      ajv.validate(
        JSON.parse(
          readFileSync(
            resolve(directory, 'billing.create-charge.v1.schema.json'),
            'utf8',
          ),
        ),
        charges[0].payload,
      ),
    ).toBe(true);
    expect(charges[0].payload.data).toMatchObject({
      totalInCents: 1000,
      externalPosId: 'pos-001',
    });
  });
});
