import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import {
  ChargeCancellationEventConsumer,
  chargeCancellationEventValidator,
} from './ChargeCancellationEventConsumer';

describe('ChargeCancellationEventConsumer', () => {
  const dir = resolve(process.cwd(), 'docs/contracts/messages');
  const validate = chargeCancellationEventValidator(dir);
  const fixture = JSON.parse(
    readFileSync(
      resolve(dir, 'examples/billing.charge-canceled.v1.json'),
      'utf8',
    ),
  ) as { messageId: string; type: string };
  const message = {
    messageId: fixture.messageId,
    subject: fixture.type,
    body: fixture,
  } as ServiceBusReceivedMessage;
  const handler = { execute: jest.fn() };
  const receiver = {
    completeMessage: jest.fn(),
    abandonMessage: jest.fn(),
    deadLetterMessage: jest.fn(),
  };
  const broker = receiver as unknown as ServiceBusReceiver;
  const consumer = new ChargeCancellationEventConsumer(handler, validate);
  beforeEach(() => {
    jest.resetAllMocks();
    handler.execute.mockResolvedValue('APPLIED');
  });
  it('confirma apenas depois de persistir, inclusive quando fica pendente', async () => {
    handler.execute.mockResolvedValueOnce('PENDING');
    await consumer.process(message, broker);
    expect(handler.execute).toHaveBeenCalledWith(fixture);
    expect(receiver.completeMessage).toHaveBeenCalledWith(message);
  });
  it('encaminha schema, subject e ID inválidos à DLQ', async () => {
    await consumer.process({ ...message, messageId: 'outro' }, broker);
    await consumer.process({ ...message, subject: 'outro' }, broker);
    await consumer.process(
      { ...message, body: { ...fixture, schemaVersion: 2 } },
      broker,
    );
    expect(receiver.deadLetterMessage).toHaveBeenCalledTimes(3);
    expect(handler.execute).not.toHaveBeenCalled();
  });
  it('abandona falha do banco e propaga falha do ACK', async () => {
    handler.execute.mockRejectedValueOnce(new Error('db'));
    await consumer.process(message, broker);
    expect(receiver.abandonMessage).toHaveBeenCalledWith(message);
    receiver.completeMessage.mockRejectedValueOnce(new Error('lock'));
    await expect(consumer.process(message, broker)).rejects.toThrow('lock');
    expect(receiver.abandonMessage).toHaveBeenCalledTimes(1);
  });
});
