import { PrismaClient } from '@prisma/client';
import { ChargeEvent } from './ReceberCobranca';

type Handler = { execute(event: ChargeEvent): Promise<'APPLIED' | 'PENDING'> };
type Cursor = { receivedAt: Date; messageId: string };

/** The caller must cycle through pages and schedule another scan later. */
export class ReplayPendingChargeEvents {
  constructor(
    private readonly db: PrismaClient,
    private readonly handler: Handler,
    private readonly validate: (event: unknown) => boolean,
  ) {}

  async execute(
    limit = 50,
    cursor?: Cursor,
  ): Promise<{
    applied: number;
    pending: number;
    errors: number;
    next: Cursor | null;
  }> {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor &&
        (!Number.isFinite(cursor.receivedAt.getTime()) || !cursor.messageId))
    )
      throw new Error('Paginação inválida');
    const date = cursor?.receivedAt ?? null;
    const id = cursor?.messageId ?? null;
    const rows = await this.db.$queryRaw<
      Array<{ payload: unknown; receivedAt: Date; messageId: string }>
    >`
      SELECT "payload", "receivedAt", "messageId" FROM "Inbox"
      WHERE "consumer" = 'os.saga-events' AND "status" = 'PENDING'
        AND "type" = 'billing.charge-created.v1'
        AND (${date}::timestamp IS NULL OR ("receivedAt", "messageId") > (${date}::timestamp, ${id}::text))
      ORDER BY "receivedAt", "messageId" LIMIT ${limit}`;
    const result = {
      applied: 0,
      pending: 0,
      errors: 0,
      next:
        rows.length === limit
          ? {
              receivedAt: rows[rows.length - 1].receivedAt,
              messageId: rows[rows.length - 1].messageId,
            }
          : null,
    };
    for (const row of rows) {
      if (!this.validate(row.payload)) {
        result.errors++;
        continue;
      }
      try {
        const outcome = await this.handler.execute(row.payload as ChargeEvent);
        if (outcome === 'APPLIED') result.applied++;
        else result.pending++;
      } catch {
        result.errors++;
      }
    }
    return result;
  }
}
