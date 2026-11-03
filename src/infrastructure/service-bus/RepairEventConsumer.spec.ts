import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import {
  RepairEventConsumer,
  repairEventValidator,
} from './RepairEventConsumer';

describe('consumidor de reparo', () => {
  const directory = resolve(process.cwd(), 'docs/contracts/messages');
  const body = JSON.parse(
    readFileSync(
      resolve(directory, 'examples/execution.work-started.v1.json'),
      'utf8',
    ),
  ) as { messageId: string };
  const receiver = {
    completeMessage: jest.fn(),
    abandonMessage: jest.fn(),
    deadLetterMessage: jest.fn(),
  };
  const handler = { execute: jest.fn() };
  const consumer = new RepairEventConsumer(
    handler,
    repairEventValidator(directory),
  );
  const deliver = (messageBody: unknown, id = body.messageId) =>
    consumer.process(
      { messageId: id, body: messageBody } as ServiceBusReceivedMessage,
      receiver as unknown as ServiceBusReceiver,
    );
  beforeEach(() => {
    jest.resetAllMocks();
    handler.execute.mockResolvedValue('PENDING');
  });
  it('confirma somente após registrar o evento pendente', async () => {
    await deliver(body);
    expect(handler.execute).toHaveBeenCalledWith(body);
    expect(receiver.completeMessage).toHaveBeenCalledTimes(1);
  });
  it('rejeita mensagem incompatível e não confirma falha de persistência', async () => {
    await deliver(body, 'wrong');
    expect(receiver.deadLetterMessage).toHaveBeenCalledTimes(1);
    handler.execute.mockRejectedValue(new Error('banco'));
    await deliver(body);
    expect(receiver.abandonMessage).toHaveBeenCalledTimes(1);
    expect(receiver.completeMessage).not.toHaveBeenCalled();
  });
});
