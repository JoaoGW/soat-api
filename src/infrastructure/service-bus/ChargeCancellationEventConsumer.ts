import { ChargeCancellationEvent } from '../saga/ReceberCancelamentoCobranca';
import {
  ContractEventConsumer,
  contractValidator,
} from './ContractEventConsumer';

export const chargeCancellationEventValidator = (directory: string) =>
  contractValidator(directory, ['billing.charge-canceled.v1']);

/** Route only charge event types here; other events need their own handlers. */
export class ChargeCancellationEventConsumer extends ContractEventConsumer<ChargeCancellationEvent> {}
