import { WorkEnqueuedEvent } from '../saga/ReceberEnfileiramento';
import {
  ContractEventConsumer,
  contractValidator,
} from './ContractEventConsumer';

export const workEnqueuedEventValidator = (directory: string) =>
  contractValidator(directory, ['execution.work-enqueued.v1']);

/** Route only work-enqueued events here; other events need their own handlers. */
export class WorkEnqueuedEventConsumer extends ContractEventConsumer<WorkEnqueuedEvent> {}
