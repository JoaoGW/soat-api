import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';

type Receiver = Pick<
  ServiceBusReceiver,
  'completeMessage' | 'abandonMessage' | 'deadLetterMessage'
>;
type Handler<T> = { execute(event: T): Promise<'APPLIED' | 'PENDING'> };

/** Valida o evento contra o envelope e um dos schemas versionados informados. */
export function contractValidator(
  directory: string,
  types: string[],
): (event: unknown) => boolean {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const read = (file: string): object =>
    JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as object;
  ajv.addSchema(read('envelope.schema.json'));
  const validators = types.map((type) =>
    ajv.compile(read(`${type}.schema.json`)),
  );
  return (event) => validators.some((validate) => validate(event) === true);
}

/**
 * Contrato inválido segue à DLQ; falha do caso de uso devolve a mensagem para
 * nova entrega. O ACK só ocorre depois de o caso de uso persistir a inbox.
 */
export class ContractEventConsumer<T> {
  constructor(
    private readonly handler: Handler<T>,
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
      await this.handler.execute(body as T);
    } catch {
      await receiver.abandonMessage(message);
      return;
    }
    await receiver.completeMessage(message);
  }
}
