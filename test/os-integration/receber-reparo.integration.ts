import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  ReceiveRepairEvent,
  RepairEvent,
} from '../../src/infrastructure/saga/ReceberReparo';
import { ReplayPendingChargeEvents } from '../../src/infrastructure/saga/ReaplicarCobrancas';

const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');

describe('eventos de reparo na Saga', () => {
  const db = new PrismaClient();
  const service = new ReceiveRepairEvent(db);
  const prefix = randomUUID();
  const client = `client-${prefix}`;
  const vehicle = `vehicle-${prefix}`;
  beforeAll(async () => {
    const document = String(
      BigInt('0x' + prefix.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
    await db.$executeRaw`INSERT INTO "Cliente" ("id", "nome", "documento", "tipo", "contato", "updatedAt") VALUES (${client}, 'Teste', ${document}, 'PF', 'test', NOW())`;
    await db.$executeRaw`INSERT INTO "Veiculo" ("id", "clienteId", "placa", "marca", "modelo", "ano", "updatedAt") VALUES (${vehicle}, ${client}, ${prefix.slice(0, 7)}, 'X', 'Y', 2020, NOW())`;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  async function setup(status = 'NA_FILA') {
    const id = randomUUID();
    const osId = `os-${id}`;
    const sagaId = `saga-${id}`;
    const executionId = `execution-${id}`;
    const reservationId = `reservation-${id}`;
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${osId}, ${id}, ${client}, ${vehicle}, 'branch', 'NA_FILA', NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "executionId", "reservationId", "updatedAt") VALUES (${sagaId}, ${osId}, 'branch', ${status}, ${executionId}, ${reservationId}, NOW())`;
    const start: RepairEvent = {
      messageId: `start-${id}`,
      operationId: `start-op-${id}`,
      type: 'execution.work-started.v1',
      producer: 'soat-execution-service',
      osId,
      sagaId,
      filialId: 'branch',
      data: {
        executionId,
        reservationId,
        startedAt: '2030-01-01T00:00:00.000Z',
      },
    };
    const finish: RepairEvent = {
      ...start,
      messageId: `finish-${id}`,
      operationId: `finish-op-${id}`,
      type: 'execution.work-completed.v1',
      data: { ...start.data, completedAt: '2030-01-01T01:00:00.000Z' },
    };
    return { start, finish };
  }
  it('persiste conclusão fora de ordem e depois atualiza projeção sem duplicar histórico', async () => {
    const { start, finish } = await setup();
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
      service,
      () => true,
    );
    expect((await replay.execute()).applied).toBeGreaterThanOrEqual(1);
    expect(await service.execute(finish)).toBe('APPLIED');
    const saga = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "id" = ${start.sagaId}`;
    const os = await db.$queryRaw<
      Array<{ status: string; dataInicioExecucao: Date; dataFinalizacao: Date }>
    >`SELECT "status", "dataInicioExecucao", "dataFinalizacao" FROM "OrdemDeServico" WHERE "id" = ${start.osId}`;
    const history = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) AS count FROM "HistoricoStatusOS" WHERE "osId" = ${start.osId}`;
    expect(saga[0].status).toBe('CONCLUIDA');
    expect(os[0].status).toBe('FINALIZADA');
    expect(os[0].dataInicioExecucao.toISOString()).toBe(start.data.startedAt);
    expect(os[0].dataFinalizacao.toISOString()).toBe(finish.data.completedAt);
    expect(Number(history[0].count)).toBe(2);
    await expect(
      service.execute({
        ...finish,
        data: { ...finish.data, completedAt: '2030-01-01T02:00:00.000Z' },
      }),
    ).rejects.toThrow('Mensagem reutilizada');
  });
  it('início durante compensação exige reconciliação', async () => {
    const { start } = await setup('COMPENSANDO');
    expect(await service.execute(start)).toBe('APPLIED');
    const rows = await db.$queryRaw<
      Array<{ status: string; requiresAttention: boolean }>
    >`SELECT "status", "requiresAttention" FROM "SagaInstance" WHERE "id" = ${start.sagaId}`;
    expect(rows[0]).toEqual({
      status: 'RECONCILIACAO_NECESSARIA',
      requiresAttention: true,
    });
  });
});
