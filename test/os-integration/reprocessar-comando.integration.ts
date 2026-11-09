import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { RetryFailedCommand } from '../../src/infrastructure/saga/ReprocessarComando';
const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');

describe('recuperação de comandos da Saga', () => {
  const db = new PrismaClient();
  const retry = new RetryFailedCommand(db);
  const id = randomUUID();
  const client = `client-${id}`,
    vehicle = `vehicle-${id}`;
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
  async function setup(status = 'DIAGNOSTICO_PENDENTE') {
    const tag = randomUUID();
    const sagaId = `saga-${tag}`,
      osId = `os-${tag}`,
      messageId = `message-${tag}`,
      operationId = `op-${tag}`,
      type = 'execution.request-diagnosis.v1';
    await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id","codigoAcompanhamento","clienteId","veiculoId","filialId","status","updatedAt") VALUES (${osId},${tag},${client},${vehicle},'branch','RECEBIDA',NOW())`;
    await db.$executeRaw`INSERT INTO "SagaInstance" ("id","osId","filialId","status","updatedAt") VALUES (${sagaId},${osId},'branch',${status},NOW())`;
    await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId","sagaId","step","businessAttempt","commandType","status","updatedAt") VALUES (${operationId},${sagaId},'REQUEST_DIAGNOSIS',1,${type},'PENDING',NOW())`;
    const payload = JSON.stringify({ messageId, operationId, sagaId, type });
    await db.$executeRaw`INSERT INTO "Outbox" ("messageId","type","payload","status","attemptCount") VALUES (${messageId},${type},${payload}::jsonb,'FAILED',5)`;
    return { sagaId, messageId, actorId: 'admin', reason: 'BROKER_RESTORED' };
  }
  it('rearma a mensagem original uma vez e registra auditoria mesmo sob concorrência', async () => {
    const input = await setup();
    const results = await Promise.allSettled([
      retry.execute(input),
      retry.execute(input),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rows = await db.$queryRaw<
      Array<{
        status: string;
        attemptCount: number;
        payload: { messageId: string };
      }>
    >`SELECT "status","attemptCount","payload" FROM "Outbox" WHERE "messageId"=${input.messageId}`;
    expect(rows[0]).toMatchObject({
      status: 'PENDING',
      attemptCount: 0,
      payload: { messageId: input.messageId },
    });
    const audit = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM "SagaRecoveryAudit" WHERE "sagaId"=${input.sagaId}`;
    expect(audit[0].count).toBe(1n);
    await db.$executeRaw`DELETE FROM "Outbox" WHERE "messageId"=${input.messageId}`;
  });
  it('não reenvia comando obsoleto nem altera Saga em reconciliação', async () => {
    const obsolete = await setup('COMPENSANDO');
    const reconcile = await setup('RECONCILIACAO_NECESSARIA');
    await expect(retry.execute(obsolete)).rejects.toThrow('incompatível');
    await expect(retry.execute(reconcile)).rejects.toThrow('Saga não permite');
  });
});
