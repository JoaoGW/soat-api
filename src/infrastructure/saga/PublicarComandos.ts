import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

type Outbox = {
  messageId: string;
  type: string;
  payload: unknown;
  attemptCount: number;
};
export type CommandPublisher = {
  publish(command: {
    messageId: string;
    type: string;
    payload: unknown;
  }): Promise<void>;
};
/** At least once: the message identifier remains unchanged on uncertain sends. */
export class DispatchCommands {
  constructor(
    private readonly db: PrismaClient,
    private readonly publisher: CommandPublisher,
  ) {}
  async execute(
    now = new Date(),
  ): Promise<'EMPTY' | 'SENT' | 'RETRY' | 'FAILED' | 'CLAIM_LOST'> {
    if (!Number.isFinite(now.getTime())) throw new Error('Data inválida');
    const owner = randomUUID();
    const until = new Date(now.getTime() + 30000);
    const rows = await this.db.$queryRaw<Outbox[]>`
      WITH candidate AS (SELECT "messageId" FROM "Outbox" WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now} AND ("claimUntil" IS NULL OR "claimUntil" <= ${now}) ORDER BY "createdAt", "messageId" FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE "Outbox" AS item SET "claimOwner" = ${owner}, "claimUntil" = ${until} FROM candidate WHERE item."messageId" = candidate."messageId" RETURNING item.*`;
    const item = rows[0];
    if (!item) return 'EMPTY';
    try {
      await this.publisher.publish({
        messageId: item.messageId,
        type: item.type,
        payload: item.payload,
      });
    } catch {
      const attempts = item.attemptCount + 1;
      const failed = attempts >= 5;
      const retryAt = new Date(
        now.getTime() + Math.min(60000, 1000 * 2 ** (attempts - 1)),
      );
      const updated = await this.db
        .$executeRaw`UPDATE "Outbox" SET "status" = ${failed ? 'FAILED' : 'PENDING'}, "attemptCount" = ${attempts}, "nextAttemptAt" = ${retryAt}, "claimOwner" = NULL, "claimUntil" = NULL WHERE "messageId" = ${item.messageId} AND "status" = 'PENDING' AND "claimOwner" = ${owner}`;
      return updated === 1 ? (failed ? 'FAILED' : 'RETRY') : 'CLAIM_LOST';
    }
    const updated = await this.db
      .$executeRaw`UPDATE "Outbox" SET "status" = 'SENT', "publishedAt" = NOW(), "claimOwner" = NULL, "claimUntil" = NULL WHERE "messageId" = ${item.messageId} AND "status" = 'PENDING' AND "claimOwner" = ${owner}`;
    return updated === 1 ? 'SENT' : 'CLAIM_LOST';
  }
}
