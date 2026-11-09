import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DispatchCommands } from '../../src/infrastructure/saga/PublicarComandos';

const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A integração exige banco local de teste');

describe('publicação da outbox da Saga', () => {
  const db = new PrismaClient();
  const now = new Date('2030-01-01T00:00:00Z');
  afterAll(async () => {
    await db.$disconnect();
  });
  async function seed() {
    const id = randomUUID();
    const payload = { messageId: id, type: 'execution.request-diagnosis.v1' };
    const old = new Date('2000-01-01T00:00:00Z');
    await db.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload", "createdAt", "nextAttemptAt") VALUES (${id}, ${payload.type}, ${JSON.stringify(payload)}::jsonb, ${old}, ${old})`;
    return id;
  }
  it('somente um worker reclama e publica a mensagem', async () => {
    const id = await seed();
    const publish = jest.fn().mockResolvedValue(undefined);
    const handler = new DispatchCommands(db, { publish });
    await Promise.all([handler.execute(now), handler.execute(now)]);
    expect(
      publish.mock.calls.filter(([event]) => event.messageId === id),
    ).toHaveLength(1);
    const rows = await db.$queryRaw<
      Array<{ status: string }>
    >`SELECT "status" FROM "Outbox" WHERE "messageId" = ${id}`;
    expect(rows[0].status).toBe('SENT');
  });
  it('retenta envio incerto com o mesmo identificador', async () => {
    const id = await seed();
    const publish = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(undefined);
    const handler = new DispatchCommands(db, { publish });
    expect(await handler.execute(now)).toBe('RETRY');
    expect(await handler.execute(new Date(now.getTime() + 2000))).toBe('SENT');
    expect(publish.mock.calls.map(([item]) => item.messageId)).toEqual([
      id,
      id,
    ]);
  });
});
