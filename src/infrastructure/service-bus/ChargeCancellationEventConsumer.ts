import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import { ChargeCancellationEvent } from '../saga/ReceberCancelamentoCobranca';

type Receiver = Pick<
  ServiceBusReceiver,
  'completeMessage' | 'abandonMessage' | 'deadLetterMessage'
>;
type Handler = {
  execute(event: ChargeCancellationEvent): Promise<'APPLIED' | 'PENDING'>;
};

export function chargeCancellationEventValidator(
  directory: string,
): (event: unknown) => boolean {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const read = (file: string): object =>
    JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as object;
  ajv.addSchema(read('envelope.schema.json'));
  const canceled = ajv.compile(read('billing.charge-canceled.v1.schema.json'));
  return (event) => canceled(event) === true;
}

/** Route only charge event types here; other events need their own handlers. */
export class ChargeCancellationEventConsumer {
  constructor(
    private readonly handler: Handler,
    private readonly validate: (event: unknown) => boolean,
  ) {}
  async process(
    message: ServiceBusReceivedMessage,
    receiver: Receiver,
  ): Promise<void> {
    const body: unknown = message.body;
    if (
      !this.validate(body) ||
      !body ||
      typeof body !== 'object' ||
      !('messageId' in body) ||
      !('type' in body) ||
      body.messageId !== message.messageId ||
      (message.subject && message.subject !== body.type)
    ) {
      await receiver.deadLetterMessage(message, {
        deadLetterReason: 'InvalidContract',
        deadLetterErrorDescription: 'Mensagem inválida ou versão não suportada',
      });
      return;
    }
    try {
      // Both APPLIED and PENDING are committed to inbox before ACK.
      await this.handler.execute(body as ChargeCancellationEvent);
    } catch {
      await receiver.abandonMessage(message);
      return;
    }
    await receiver.completeMessage(message);
  }
}
