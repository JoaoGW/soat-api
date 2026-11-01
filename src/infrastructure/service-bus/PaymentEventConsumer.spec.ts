import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import {
  PaymentEventConsumer,
  paymentEventValidator,
} from './PaymentEventConsumer';

describe('PaymentEventConsumer', () => {
  const dir = resolve(process.cwd(), 'docs/contracts/messages');
  const validate = paymentEventValidator(dir);
  const fixture = JSON.parse(
    readFileSync(
      resolve(dir, 'examples/billing.payment-confirmed.v1.json'),
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
  const consumer = new PaymentEventConsumer(handler, validate);
  beforeEach(() => {
    jest.resetAllMocks();
    handler.execute.mockResolvedValue('PENDING');
  });
  it('confirma após gravar o fato pendente', async () => {
    await consumer.process(message, broker);
    expect(receiver.completeMessage).toHaveBeenCalledWith(message);
  });
  it('rejeita contrato ou identidade de mensagem divergente', async () => {
    await consumer.process({ ...message, messageId: 'other' }, broker);
    await consumer.process(
      { ...message, body: { ...fixture, producer: 'other' } },
      broker,
    );
    expect(receiver.deadLetterMessage).toHaveBeenCalledTimes(2);
    expect(handler.execute).not.toHaveBeenCalled();
  });
  it('abandona falha de persistência e propaga falha de confirmação', async () => {
    handler.execute.mockRejectedValueOnce(new Error('db'));
    await consumer.process(message, broker);
    expect(receiver.abandonMessage).toHaveBeenCalledWith(message);
    receiver.completeMessage.mockRejectedValueOnce(new Error('lock'));
    await expect(consumer.process(message, broker)).rejects.toThrow('lock');
  });
});
