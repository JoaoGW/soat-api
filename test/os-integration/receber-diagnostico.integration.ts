import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  ReceiveDiagnosisEvent,
  DiagnosisEvent,
} from '../../src/infrastructure/saga/ReceberDiagnostico';
import { ReplayPendingChargeEvents } from '../../src/infrastructure/saga/ReaplicarCobrancas';
const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');

describe('diagnóstico e orçamento na Saga', () => {
  const db = new PrismaClient();
  const service = new ReceiveDiagnosisEvent(db);
  const id = randomUUID();
  const client = `client-${id}`;
  const vehicle = `vehicle-${id}`;
  const osId = `os-${id}`;
  const sagaId = `saga-${id}`;
  const start: DiagnosisEvent = {
    messageId: `start-${id}`,
    operationId: `start-op-${id}`,
    type: 'execution.diagnosis-started.v1',
    producer: 'soat-execution-service',
    osId,
    sagaId,
    filialId: 'branch',
    correlationId: id,
    data: { diagnosisId: osId, diagnosisVersion: 2 },
  };
  const finish: DiagnosisEvent = {
    ...start,
    messageId: `finish-${id}`,
    operationId: `finish-op-${id}`,
    type: 'execution.diagnosis-completed.v1',
    traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    tracestate: 'vendor=state',
    data: {
      diagnosisId: osId,
      diagnosisVersion: 3,
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
  beforeAll(async () => {
    const document = String(
      BigInt('0x' + id.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
    await db.$executeRaw`INSERT INTO "Cliente" ("id", "nome", "documento", "tipo", "contato", "updatedAt") VALUES (${client}, 'Teste', ${document}, 'PF', 'test@example.test', NOW())`;
    await db.$executeRaw`INSERT INTO "Veiculo" ("id", "clienteId", "placa", "marca", "modelo", "ano", "updatedAt") VALUES (${vehicle}, ${client}, ${id.slice(0, 7)}, 'X', 'Y', 2020, NOW())`;
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${osId}, ${id}, ${client}, ${vehicle}, 'branch', 'RECEBIDA', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "updatedAt") VALUES (${sagaId}, ${osId}, 'branch', 'DIAGNOSTICO_PENDENTE', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${`request-${id}`}, ${sagaId}, 'REQUEST_DIAGNOSIS', 1, 'execution.request-diagnosis.v1', 'SENT', NOW())`;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  it('guarda conclusão fora de ordem e cria uma única ordem de orçamento com preços fixados', async () => {
    expect(await service.execute(finish)).toBe('PENDING');
    expect(
      await Promise.all([service.execute(start), service.execute(start)]),
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
      service,
      () => true,
    );
    expect((await replay.execute()).applied).toBeGreaterThanOrEqual(1);
    expect(await service.execute(finish)).toBe('APPLIED');
    const rows = await db.$queryRaw<
      Array<{ payload: { data: { items: unknown; clienteId: string } } }>
    >`SELECT "payload" FROM "Outbox" WHERE "type" = 'billing.generate-quote.v1' AND "payload"->>'sagaId' = ${sagaId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({
      traceparent: finish.traceparent,
      tracestate: finish.tracestate,
    });
    expect(rows[0].payload.data).toMatchObject({
      clienteId: client,
      items: finish.data.items,
    });
    const state = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${sagaId}`;
    expect(state[0].status).toBe('ORCAMENTO_PENDENTE');
  });
});
