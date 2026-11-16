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
type Dispatch = 'EMPTY' | 'SENT' | 'RETRY' | 'FAILED' | 'CLAIM_LOST';
/** At least once: the message identifier remains unchanged on uncertain sends. */
export class DispatchCommands {
  constructor(
    private readonly db: PrismaClient,
    private readonly publisher: CommandPublisher,
  ) {}
  async execute(now = new Date()): Promise<Dispatch> {
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
      if (!failed) {
        const updated = await this.db
          .$executeRaw`UPDATE "Outbox" SET "attemptCount" = ${attempts}, "nextAttemptAt" = ${retryAt}, "claimOwner" = NULL, "claimUntil" = NULL WHERE "messageId" = ${item.messageId} AND "status" = 'PENDING' AND "claimOwner" = ${owner}`;
        return updated === 1 ? 'RETRY' : 'CLAIM_LOST';
      }
      // Desistir do comando exige operador: a Saga fica sinalizada na mesma
      // transação em que a mensagem deixa de ser tentada.
      return this.db.$transaction(async (tx) => {
        const updated =
          await tx.$executeRaw`UPDATE "Outbox" SET "status" = 'FAILED', "attemptCount" = ${attempts}, "nextAttemptAt" = ${retryAt}, "claimOwner" = NULL, "claimUntil" = NULL WHERE "messageId" = ${item.messageId} AND "status" = 'PENDING' AND "claimOwner" = ${owner}`;
        if (updated !== 1) return 'CLAIM_LOST';
        await tx.$executeRaw`UPDATE "SagaInstance" SET "requiresAttention" = true, "lastError" = 'OUTBOX_FAILED', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = (SELECT "payload"->>'sagaId' FROM "Outbox" WHERE "messageId" = ${item.messageId})`;
        return 'FAILED';
      });
    }
    const updated = await this.db
      .$executeRaw`UPDATE "Outbox" SET "status" = 'SENT', "publishedAt" = NOW(), "claimOwner" = NULL, "claimUntil" = NULL WHERE "messageId" = ${item.messageId} AND "status" = 'PENDING' AND "claimOwner" = ${owner}`;
    return updated === 1 ? 'SENT' : 'CLAIM_LOST';
  }

  /**
   * Publica até `max` mensagens em sequência, cada uma reclamada com o mesmo
   * bloqueio por linha de `execute`. `drained` indica que a fila ficou vazia e
   * o chamador pode aguardar; caso contrário deve chamar de novo imediatamente.
   */
  async drain(
    max = 20,
    clock: () => Date = () => new Date(),
  ): Promise<{ processed: number; drained: boolean }> {
    if (!Number.isSafeInteger(max) || max < 1 || max > 100)
      throw new Error('Lote inválido');
    let processed = 0;
    while (processed < max) {
      if ((await this.execute(clock())) === 'EMPTY')
        return { processed, drained: true };
      processed++;
    }
    return { processed, drained: false };
  }
}
