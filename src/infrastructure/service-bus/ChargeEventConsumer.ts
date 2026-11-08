import { ChargeEvent } from '../saga/ReceberCobranca';
import {
  ContractEventConsumer,
  contractValidator,
} from './ContractEventConsumer';

export const chargeEventValidator = (directory: string) =>
  contractValidator(directory, [
    'billing.charge-created.v1',
    'billing.charge-failed.v1',
  ]);

/** Route only charge event types here; other events need their own handlers. */
export class ChargeEventConsumer extends ContractEventConsumer<ChargeEvent> {}
