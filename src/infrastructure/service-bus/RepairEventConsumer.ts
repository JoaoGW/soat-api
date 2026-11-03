import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import { RepairEvent } from '../saga/ReceberReparo';
import { DiagnosisEvent } from '../saga/ReceberDiagnostico';

type Receiver = Pick<
  ServiceBusReceiver,
  'completeMessage' | 'abandonMessage' | 'deadLetterMessage'
>;
export function repairEventValidator(
  directory: string,
): (event: unknown) => boolean {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const read = (file: string): object =>
    JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as object;
  ajv.addSchema(read('envelope.schema.json'));
  const validators = [
    'execution.work-started.v1',
    'execution.work-completed.v1',
  ].map((name) => ajv.compile(read(`${name}.schema.json`)));
  return (event) => validators.some((validate) => validate(event) === true);
}
export class RepairEventConsumer {
  constructor(
    private readonly handler: {
      execute(event: RepairEvent): Promise<'APPLIED' | 'PENDING'>;
    },
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
        deadLetterErrorDescription: 'Evento inválido',
      });
      return;
    }
    try {
      await this.handler.execute(body as RepairEvent);
    } catch {
      await receiver.abandonMessage(message);
      return;
    }
    await receiver.completeMessage(message);
  }
}

export function diagnosisEventValidator(
  directory: string,
): (event: unknown) => boolean {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const read = (file: string): object =>
    JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as object;
  ajv.addSchema(read('envelope.schema.json'));
  const validators = [
    'execution.diagnosis-started.v1',
    'execution.diagnosis-completed.v1',
  ].map((name) => ajv.compile(read(`${name}.schema.json`)));
  return (event) => validators.some((validate) => validate(event) === true);
}
export class DiagnosisEventConsumer {
  constructor(
    private readonly handler: {
      execute(event: DiagnosisEvent): Promise<'APPLIED' | 'PENDING'>;
    },
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
        deadLetterErrorDescription: 'Evento inválido',
      });
      return;
    }
    try {
      await this.handler.execute(body as DiagnosisEvent);
    } catch {
      await receiver.abandonMessage(message);
      return;
    }
    await receiver.completeMessage(message);
  }
}

export function quoteEventValidator(
  directory: string,
): (event: unknown) => boolean {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const read = (file: string): object =>
    JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as object;
  ajv.addSchema(read('envelope.schema.json'));
  const validators = [
    'billing.quote-issued.v1',
    'billing.quote-approved.v1',
    'billing.quote-rejected.v1',
  ].map((name) => ajv.compile(read(`${name}.schema.json`)));
  return (event) => validators.some((validate) => validate(event) === true);
}
export class QuoteEventConsumer {
  constructor(
    private readonly handler: {
      execute(
        event: import('../saga/ReceberOrcamento').QuoteEvent,
      ): Promise<'APPLIED' | 'PENDING'>;
    },
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
        deadLetterErrorDescription: 'Evento inválido',
      });
      return;
    }
    try {
      await this.handler.execute(
        body as import('../saga/ReceberOrcamento').QuoteEvent,
      );
    } catch {
      await receiver.abandonMessage(message);
      return;
    }
    await receiver.completeMessage(message);
  }
}

export function reservationEventValidator(
  directory: string,
): (event: unknown) => boolean {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const read = (file: string): object =>
    JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as object;
  ajv.addSchema(read('envelope.schema.json'));
  const validate = ajv.compile(read('execution.parts-reserved.v1.schema.json'));
  return (event) => validate(event) === true;
}
export class ReservationEventConsumer {
  constructor(
    private readonly handler: {
      execute(
        event: import('../saga/ReceberReserva').ReservationEvent,
      ): Promise<'APPLIED' | 'PENDING'>;
    },
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
        deadLetterErrorDescription: 'Evento inválido',
      });
      return;
    }
    try {
      await this.handler.execute(
        body as import('../saga/ReceberReserva').ReservationEvent,
      );
    } catch {
      await receiver.abandonMessage(message);
      return;
    }
    await receiver.completeMessage(message);
  }
}

export function cancellationEventValidator(
  directory: string,
): (event: unknown) => boolean {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const read = (file: string): object =>
    JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as object;
  ajv.addSchema(read('envelope.schema.json'));
  const validate = ajv.compile(read('execution.work-cancelled.v1.schema.json'));
  return (event) => validate(event) === true;
}
export class CancellationEventConsumer {
  constructor(
    private readonly handler: {
      execute(
        event: import('../saga/ReceberCancelamento').CancellationEvent,
      ): Promise<'APPLIED' | 'PENDING'>;
    },
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
        deadLetterErrorDescription: 'Evento inválido',
      });
      return;
    }
    try {
      await this.handler.execute(
        body as import('../saga/ReceberCancelamento').CancellationEvent,
      );
    } catch {
      await receiver.abandonMessage(message);
      return;
    }
    await receiver.completeMessage(message);
  }
}
