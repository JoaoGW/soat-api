import { RepairEvent } from '../saga/ReceberReparo';
import { DiagnosisEvent } from '../saga/ReceberDiagnostico';
import { QuoteEvent } from '../saga/ReceberOrcamento';
import { ReservationEvent } from '../saga/ReceberReserva';
import { CancellationEvent } from '../saga/ReceberCancelamento';
import { RefundEvent } from '../saga/ReceberReembolso';
import { ReleaseEvent } from '../saga/ReceberLiberacao';
import { FailureEvent } from '../saga/ReceberFalha';
import {
  ContractEventConsumer,
  contractValidator,
} from './ContractEventConsumer';

export const repairEventValidator = (directory: string) =>
  contractValidator(directory, [
    'execution.work-started.v1',
    'execution.work-completed.v1',
  ]);
export class RepairEventConsumer extends ContractEventConsumer<RepairEvent> {}

export const diagnosisEventValidator = (directory: string) =>
  contractValidator(directory, [
    'execution.diagnosis-started.v1',
    'execution.diagnosis-completed.v1',
  ]);
export class DiagnosisEventConsumer extends ContractEventConsumer<DiagnosisEvent> {}

export const quoteEventValidator = (directory: string) =>
  contractValidator(directory, [
    'billing.quote-issued.v1',
    'billing.quote-approved.v1',
    'billing.quote-rejected.v1',
  ]);
export class QuoteEventConsumer extends ContractEventConsumer<QuoteEvent> {}

export const reservationEventValidator = (directory: string) =>
  contractValidator(directory, ['execution.parts-reserved.v1']);
export class ReservationEventConsumer extends ContractEventConsumer<ReservationEvent> {}

export const cancellationEventValidator = (directory: string) =>
  contractValidator(directory, ['execution.work-cancelled.v1']);
export class CancellationEventConsumer extends ContractEventConsumer<CancellationEvent> {}

export const refundEventValidator = (directory: string) =>
  contractValidator(directory, ['billing.payment-refunded.v1']);
export class RefundEventConsumer extends ContractEventConsumer<RefundEvent> {}

export const releaseEventValidator = (directory: string) =>
  contractValidator(directory, ['execution.parts-released.v1']);
export class ReleaseEventConsumer extends ContractEventConsumer<ReleaseEvent> {}

export const failureEventValidator = (directory: string) =>
  contractValidator(directory, [
    'billing.quote-failed.v1',
    'billing.charge-failed.v1',
    'billing.refund-blocked.v1',
    'billing.charge-cancel-blocked.v1',
    'execution.parts-reservation-failed.v1',
  ]);
export class FailureEventConsumer extends ContractEventConsumer<FailureEvent> {}
