import { PaymentEvent } from '../saga/ReceberPagamento';
import {
  ContractEventConsumer,
  contractValidator,
} from './ContractEventConsumer';

export const paymentEventValidator = (directory: string) =>
  contractValidator(directory, ['billing.payment-confirmed.v1']);

/** Route only payment-confirmed events here; unknown events need their own handlers. */
export class PaymentEventConsumer extends ContractEventConsumer<PaymentEvent> {}
