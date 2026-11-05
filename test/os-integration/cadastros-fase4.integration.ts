import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Phase4Registry } from '../../src/infrastructure/saga/CadastrosFase4';
import { OpenOrderWithSaga } from '../../src/infrastructure/saga/AbrirOrdem';
import { Phase4OrderQueries } from '../../src/infrastructure/saga/ConsultarOrdemFase4';
const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('Banco local de teste obrigatório');
function cpf(): string {
  const base = String(
    BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 10)) % 1000000000n,
  ).padStart(9, '0');
  const digit = (s: string) => {
    const sum = [...s].reduce(
      (total, value, index) => total + Number(value) * (s.length + 1 - index),
      0,
    );
    const mod = (sum * 10) % 11;
    return String(mod === 10 ? 0 : mod);
  };
  const first = digit(base);
  return base + first + digit(base + first);
}
function placa(): string {
  const id = randomUUID().replaceAll('-', '');
  return `ABC${parseInt(id.slice(0, 4), 16).toString().padStart(4, '0').slice(-4)}`;
}
describe('cadastros no banco OS da Fase 4', () => {
  const db = new PrismaClient();
  const registry = new Phase4Registry(db);
  const doc = cpf();
  const carPlate = placa();
  afterAll(async () => {
    await db.$disconnect();
  });
  it('cria, lista, altera e desativa cadastros preservando vínculo e abertura da Saga', async () => {
    const client = await registry.createClient({
      nome: 'Cliente Teste',
      documento: doc,
      contato: 'teste@example.test',
    });
    expect(await registry.lookupCpf(doc)).toEqual({
      cliente: { id: client.id, ativo: true },
    });
    expect(await registry.clientByDocument(doc)).toMatchObject({
      id: client.id,
    });
    await expect(
      registry.createClient({
        nome: 'Duplicado',
        documento: doc,
        contato: 'x',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const vehicle = await registry.createVehicle({
      clienteId: client.id,
      placa: carPlate,
      marca: 'Marca',
      modelo: 'Modelo',
      ano: 2020,
    });
    expect((await registry.vehicles(1, 100, client.id)).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: vehicle.id })]),
    );
    expect(
      await registry.updateClient(client.id, { nome: 'Atualizado' }),
    ).toMatchObject({ nome: 'Atualizado' });
    expect(
      await registry.updateVehicle(vehicle.id, { ano: 2021 }),
    ).toMatchObject({ ano: 2021 });
    const opened = await new OpenOrderWithSaga(db).execute({
      actorId: 'admin',
      key: `key-${randomUUID()}`,
      clienteId: client.id,
      veiculoId: vehicle.id,
      filialId: 'branch',
    });
    expect(opened.status).toBe('RECEBIDA');
    const orders = new Phase4OrderQueries(db);
    expect(await orders.get(opened.id, client.id)).toMatchObject({
      id: opened.id,
      clienteId: client.id,
    });
    expect(
      (await orders.list({ page: 1, limit: 100, clienteId: client.id })).items,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: opened.id })]),
    );
    expect(await orders.history(opened.id, client.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'RECEBIDA' })]),
    );
    expect(await orders.saga(opened.id)).toMatchObject({
      status: expect.any(String),
    });
    await db.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id","osId","status","ocorridoEm") VALUES (${randomUUID()},${opened.id},'EM_DIAGNOSTICO',NOW()-interval '20 minutes'),(${randomUUID()},${opened.id},'AGUARDANDO_APROVACAO',NOW()-interval '10 minutes')`;
    const report = await orders.report();
    expect(
      report.etapas.diagnostico.totalOSConsideradas,
    ).toBeGreaterThanOrEqual(1);
    expect(report.etapas.diagnostico.mediaEmMinutos).toBeGreaterThanOrEqual(0);
    await expect(orders.get(opened.id, 'outro-cliente')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      orders.history(opened.id, 'outro-cliente'),
    ).rejects.toMatchObject({ status: 404 });
    await registry.deactivateClient(client.id);
    await expect(orders.get(opened.id, client.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await registry.lookupCpf(doc)).toEqual({
      cliente: { id: client.id, ativo: false },
    });
    await expect(
      new OpenOrderWithSaga(db).execute({
        actorId: 'admin',
        key: `key-${randomUUID()}`,
        clienteId: client.id,
        veiculoId: vehicle.id,
        filialId: 'branch',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await registry.deactivateVehicle(vehicle.id)).toEqual({
      id: vehicle.id,
      ativo: false,
    });
  });
  it('rejeita documentos, placas, filtros e campos inválidos', async () => {
    await expect(
      registry.createClient({
        nome: 'X',
        documento: '11111111111',
        contato: 'x',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      registry.createVehicle({
        clienteId: 'missing',
        placa: 'bad',
        marca: 'x',
        modelo: 'x',
        ano: 2020,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(registry.clients(0, 20)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      registry.updateClient('id', { ativo: true } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});
