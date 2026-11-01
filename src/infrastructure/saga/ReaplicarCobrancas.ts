import { PrismaClient } from '@prisma/client';
import { ChargeEvent } from './ReceberCobranca';
import { PaymentEvent } from './ReceberPagamento';
import { WorkEnqueuedEvent } from './ReceberEnfileiramento';

type Handler = { execute(event: ChargeEvent): Promise<'APPLIED' | 'PENDING'> };
type PaymentHandler = {
  execute(event: PaymentEvent): Promise<'APPLIED' | 'PENDING'>;
};
type WorkHandler = {
  execute(event: WorkEnqueuedEvent): Promise<'APPLIED' | 'PENDING'>;
};
type Cursor = { receivedAt: Date; messageId: string };

/** The caller must cycle through pages and schedule another scan later. */
export class ReplayPendingChargeEvents {
  constructor(
    private readonly db: PrismaClient,
    private readonly handler: Handler,
    private readonly validate: (event: unknown) => boolean,
    private readonly paymentHandler?: PaymentHandler,
    private readonly validatePayment?: (event: unknown) => boolean,
    private readonly workHandler?: WorkHandler,
    private readonly validateWork?: (event: unknown) => boolean,
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
      Array<{
        payload: unknown;
        receivedAt: Date;
        messageId: string;
        type: string;
      }>
    >`
      SELECT "payload", "receivedAt", "messageId", "type" FROM "Inbox"
      WHERE "consumer" = 'os.saga-events' AND "status" = 'PENDING'
        AND ("type" = 'billing.charge-created.v1' OR (${Boolean(this.paymentHandler && this.validatePayment)} AND "type" = 'billing.payment-confirmed.v1') OR (${Boolean(this.workHandler && this.validateWork)} AND "type" = 'execution.work-enqueued.v1'))
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
      const isPayment = row.type === 'billing.payment-confirmed.v1';
      const isWork = row.type === 'execution.work-enqueued.v1';
      const valid = isPayment
        ? this.validatePayment?.(row.payload)
        : isWork
          ? this.validateWork?.(row.payload)
          : this.validate(row.payload);
      if (!valid) {
        result.errors++;
        continue;
      }
      try {
        const outcome =
          isPayment && this.paymentHandler
            ? await this.paymentHandler.execute(row.payload as PaymentEvent)
            : isWork && this.workHandler
              ? await this.workHandler.execute(row.payload as WorkEnqueuedEvent)
              : await this.handler.execute(row.payload as ChargeEvent);
        if (outcome === 'APPLIED') result.applied++;
        else result.pending++;
      } catch {
        result.errors++;
      }
    }
    return result;
  }
}
