import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { OpenOrderWithSaga } from '../../src/infrastructure/saga/AbrirOrdem';

const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');

describe('abertura de OS e Saga', () => {
  const db = new PrismaClient();
  const handler = new OpenOrderWithSaga(db);
  const id = randomUUID();
  const client = `client-${id}`;
  const vehicle = `vehicle-${id}`;
  const input = {
    actorId: 'admin',
    key: `key-${id}`,
    clienteId: client,
    veiculoId: vehicle,
    filialId: 'filial',
    solicitacoes: ['Revisão'],
  };
  beforeAll(async () => {
    const document = String(
      BigInt('0x' + id.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
    await db.$executeRaw`INSERT INTO "Cliente" ("id", "nome", "documento", "tipo", "contato", "updatedAt") VALUES (${client}, 'Teste', ${document}, 'PF', 'test@example.test', NOW())`;
    await db.$executeRaw`INSERT INTO "Veiculo" ("id", "clienteId", "placa", "marca", "modelo", "ano", "updatedAt") VALUES (${vehicle}, ${client}, ${id.slice(0, 7)}, 'X', 'Y', 2020, NOW())`;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  it('cria uma ordem e um comando mesmo com pedidos concorrentes repetidos', async () => {
    const [first, second] = await Promise.all([
      handler.execute(input),
      handler.execute(input),
    ]);
    expect(second).toEqual(first);
    const sagas = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "SagaInstance" WHERE "osId" = ${first.id}`;
    const events = await db.$queryRaw<
      Array<{
        payload: { data: { veiculoId: string; solicitacoes: string[] } };
      }>
    >`SELECT "payload" FROM "Outbox" WHERE "payload"->>'sagaId' = ${first.sagaId}`;
    const history = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) AS count FROM "HistoricoStatusOS" WHERE "osId" = ${first.id}`;
    expect(sagas).toEqual([{ status: 'DIAGNOSTICO_PENDENTE' }]);
    expect(events).toHaveLength(1);
    expect(events[0].payload.data).toEqual({
      veiculoId: vehicle,
      solicitacoes: ['Revisão'],
    });
    expect(Number(history[0].count)).toBe(1);
    await expect(
      handler.execute({ ...input, filialId: 'other' }),
    ).rejects.toThrow('Chave idempotente');
  });
  it('rejeita veículo não pertencente ao cliente sem criar ordem', async () => {
    await expect(
      handler.execute({
        ...input,
        key: `other-${id}`,
        veiculoId: 'inexistente',
      }),
    ).rejects.toThrow('Veículo não encontrado');
    const rows = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) AS count FROM "IdempotencyRequest" WHERE "key" = ${`other-${id}`}`;
    expect(Number(rows[0].count)).toBe(0);
  });
});
