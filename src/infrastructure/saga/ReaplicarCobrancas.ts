import { PrismaClient } from '@prisma/client';
import { ChargeEvent } from './ReceberCobranca';
import { PaymentEvent } from './ReceberPagamento';
import { WorkEnqueuedEvent } from './ReceberEnfileiramento';
import { RepairEvent } from './ReceberReparo';
import { DiagnosisEvent } from './ReceberDiagnostico';
import { QuoteEvent } from './ReceberOrcamento';
import { ReservationEvent } from './ReceberReserva';
import { CancellationEvent } from './ReceberCancelamento';
import { RefundEvent } from './ReceberReembolso';
import { ReleaseEvent } from './ReceberLiberacao';
import { FailureEvent } from './ReceberFalha';

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
    private readonly repairHandler?: {
      execute(event: RepairEvent): Promise<'APPLIED' | 'PENDING'>;
    },
    private readonly validateRepair?: (event: unknown) => boolean,
    private readonly diagnosisHandler?: {
      execute(event: DiagnosisEvent): Promise<'APPLIED' | 'PENDING'>;
    },
    private readonly validateDiagnosis?: (event: unknown) => boolean,
    private readonly quoteHandler?: {
      execute(event: QuoteEvent): Promise<'APPLIED' | 'PENDING'>;
    },
    private readonly validateQuote?: (event: unknown) => boolean,
    private readonly reservationHandler?: {
      execute(event: ReservationEvent): Promise<'APPLIED' | 'PENDING'>;
    },
    private readonly validateReservation?: (event: unknown) => boolean,
    private readonly cancellationHandler?: {
      execute(event: CancellationEvent): Promise<'APPLIED' | 'PENDING'>;
    },
    private readonly validateCancellation?: (event: unknown) => boolean,
    private readonly refundHandler?: {
      execute(event: RefundEvent): Promise<'APPLIED' | 'PENDING'>;
    },
    private readonly validateRefund?: (event: unknown) => boolean,
    private readonly releaseHandler?: {
      execute(event: ReleaseEvent): Promise<'APPLIED' | 'PENDING'>;
    },
    private readonly validateRelease?: (event: unknown) => boolean,
    private readonly failureHandler?: {
      execute(event: FailureEvent): Promise<'APPLIED' | 'PENDING'>;
    },
    private readonly validateFailure?: (event: unknown) => boolean,
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
        AND ("type" = 'billing.charge-created.v1' OR (${Boolean(this.paymentHandler && this.validatePayment)} AND "type" = 'billing.payment-confirmed.v1') OR (${Boolean(this.workHandler && this.validateWork)} AND "type" = 'execution.work-enqueued.v1') OR (${Boolean(this.repairHandler && this.validateRepair)} AND "type" IN ('execution.work-started.v1', 'execution.work-completed.v1')) OR (${Boolean(this.diagnosisHandler && this.validateDiagnosis)} AND "type" IN ('execution.diagnosis-started.v1', 'execution.diagnosis-completed.v1')) OR (${Boolean(this.quoteHandler && this.validateQuote)} AND "type" IN ('billing.quote-issued.v1', 'billing.quote-approved.v1', 'billing.quote-rejected.v1')) OR (${Boolean(this.reservationHandler && this.validateReservation)} AND "type" = 'execution.parts-reserved.v1') OR (${Boolean(this.cancellationHandler && this.validateCancellation)} AND "type" = 'execution.work-cancelled.v1') OR (${Boolean(this.refundHandler && this.validateRefund)} AND "type" = 'billing.payment-refunded.v1') OR (${Boolean(this.releaseHandler && this.validateRelease)} AND "type" = 'execution.parts-released.v1') OR (${Boolean(this.failureHandler && this.validateFailure)} AND "type" IN ('billing.quote-failed.v1', 'billing.charge-failed.v1', 'billing.refund-blocked.v1', 'execution.parts-reservation-failed.v1')))
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
      const isReservation = row.type === 'execution.parts-reserved.v1';
      const isCancellation = row.type === 'execution.work-cancelled.v1';
      const isRefund = row.type === 'billing.payment-refunded.v1';
      const isRelease = row.type === 'execution.parts-released.v1';
      const isFailure = [
        'billing.quote-failed.v1',
        'billing.charge-failed.v1',
        'billing.refund-blocked.v1',
        'execution.parts-reservation-failed.v1',
      ].includes(row.type);
      const isWork = row.type === 'execution.work-enqueued.v1';
      const isRepair =
        row.type === 'execution.work-started.v1' ||
        row.type === 'execution.work-completed.v1';
      const isDiagnosis =
        row.type === 'execution.diagnosis-started.v1' ||
        row.type === 'execution.diagnosis-completed.v1';
      const isQuote = [
        'billing.quote-issued.v1',
        'billing.quote-approved.v1',
        'billing.quote-rejected.v1',
      ].includes(row.type);
      const valid = isFailure
        ? this.validateFailure?.(row.payload)
        : isRelease
          ? this.validateRelease?.(row.payload)
          : isRefund
            ? this.validateRefund?.(row.payload)
            : isCancellation
              ? this.validateCancellation?.(row.payload)
              : isReservation
                ? this.validateReservation?.(row.payload)
                : isQuote
                  ? this.validateQuote?.(row.payload)
                  : isDiagnosis
                    ? this.validateDiagnosis?.(row.payload)
                    : isRepair
                      ? this.validateRepair?.(row.payload)
                      : isPayment
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
          isFailure && this.failureHandler
            ? await this.failureHandler.execute(row.payload as FailureEvent)
            : isRelease && this.releaseHandler
              ? await this.releaseHandler.execute(row.payload as ReleaseEvent)
              : isRefund && this.refundHandler
                ? await this.refundHandler.execute(row.payload as RefundEvent)
                : isCancellation && this.cancellationHandler
                  ? await this.cancellationHandler.execute(
                      row.payload as CancellationEvent,
                    )
                  : isReservation && this.reservationHandler
                    ? await this.reservationHandler.execute(
                        row.payload as ReservationEvent,
                      )
                    : isQuote && this.quoteHandler
                      ? await this.quoteHandler.execute(
                          row.payload as QuoteEvent,
                        )
                      : isDiagnosis && this.diagnosisHandler
                        ? await this.diagnosisHandler.execute(
                            row.payload as DiagnosisEvent,
                          )
                        : isRepair && this.repairHandler
                          ? await this.repairHandler.execute(
                              row.payload as RepairEvent,
                            )
                          : isPayment && this.paymentHandler
                            ? await this.paymentHandler.execute(
                                row.payload as PaymentEvent,
                              )
                            : isWork && this.workHandler
                              ? await this.workHandler.execute(
                                  row.payload as WorkEnqueuedEvent,
                                )
                              : await this.handler.execute(
                                  row.payload as ChargeEvent,
                                );
        if (outcome === 'APPLIED') result.applied++;
        else result.pending++;
      } catch {
        result.errors++;
      }
    }
    return result;
  }
}
