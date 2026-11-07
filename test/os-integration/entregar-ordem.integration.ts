import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DeliverOrder } from '../../src/infrastructure/saga/EntregarOrdem';

const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');

describe('entrega da ordem', () => {
  const db = new PrismaClient();
  const deliver = new DeliverOrder(db);
  const id = randomUUID();
  const client = `client-${id}`;
  const vehicle = `vehicle-${id}`;
  beforeAll(async () => {
    const document = String(
      BigInt('0x' + id.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
    await db.$executeRaw`INSERT INTO "Cliente" ("id","nome","documento","tipo","contato","updatedAt") VALUES (${client},'Teste',${document},'PF','test',NOW())`;
    await db.$executeRaw`INSERT INTO "Veiculo" ("id","clienteId","placa","marca","modelo","ano","updatedAt") VALUES (${vehicle},${client},${id.slice(0, 7)},'X','Y',2020,NOW())`;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  async function setup(
    status = 'CONCLUIDA',
    osStatus = 'FINALIZADA',
    paid = true,
  ) {
    const tag = randomUUID();
    const osId = `os-${tag}`;
    const sagaId = `saga-${tag}`;
    const chargeId = `charge-${tag}`;
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id","codigoAcompanhamento","clienteId","veiculoId","filialId","status","updatedAt") VALUES (${osId},${tag},${client},${vehicle},'branch',${osStatus},NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id","osId","filialId","status","chargeId","updatedAt") VALUES (${sagaId},${osId},'branch',${status},${chargeId},NOW())`;
    if (paid) {
      const event = JSON.stringify({ sagaId, osId, data: { chargeId } });
      await db.$executeRaw`INSERT INTO "Inbox" ("consumer","messageId","operationId","type","payload","status") VALUES ('os.saga-events',${tag},${tag},'billing.payment-confirmed.v1',${event}::jsonb,'APPLIED')`;
    }
    return { osId, sagaId };
  }
  it('entrega somente uma vez, inclusive com solicitações concorrentes', async () => {
    const { osId } = await setup();
    const outcomes = await Promise.all([
      deliver.execute(osId),
      deliver.execute(osId),
    ]);
    expect(outcomes.sort()).toEqual(['ENTREGUE', 'JA_ENTREGUE']);
    const history = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM "HistoricoStatusOS" WHERE "osId"=${osId} AND "status"='ENTREGUE'`;
    expect(history[0].count).toBe(1n);
  });
  it('recusa entrega sem pagamento, reparo concluído ou durante reconciliação', async () => {
    const unpaid = await setup('CONCLUIDA', 'FINALIZADA', false);
    const unfinished = await setup('EM_EXECUCAO', 'EM_EXECUCAO');
    const reconciliation = await setup(
      'RECONCILIACAO_NECESSARIA',
      'FINALIZADA',
    );
    for (const item of [unpaid, unfinished, reconciliation])
      await expect(deliver.execute(item.osId)).rejects.toThrow();
  });
  it('recusa entrega quando há solicitação de reembolso', async () => {
    const { osId, sagaId } = await setup();
    await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId","sagaId","step","businessAttempt","commandType","status","updatedAt") VALUES (${randomUUID()},${sagaId},'REFUND_PAYMENT',1,'billing.refund-payment.v1','PENDING',NOW())`;
    await expect(deliver.execute(osId)).rejects.toThrow('Situação financeira');
  });
});
