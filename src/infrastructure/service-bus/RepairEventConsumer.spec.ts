import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import {
  RepairEventConsumer,
  repairEventValidator,
  DiagnosisEventConsumer,
  diagnosisEventValidator,
  QuoteEventConsumer,
  quoteEventValidator,
  ReservationEventConsumer,
  reservationEventValidator,
  CancellationEventConsumer,
  cancellationEventValidator,
  RefundEventConsumer,
  refundEventValidator,
  ReleaseEventConsumer,
  releaseEventValidator,
  FailureEventConsumer,
  failureEventValidator,
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

describe('consumidores de eventos críticos', () => {
  const directory = resolve(process.cwd(), 'docs/contracts/messages');
  const cases = [
    ['billing.quote-approved.v1', QuoteEventConsumer, quoteEventValidator],
    [
      'execution.parts-reserved.v1',
      ReservationEventConsumer,
      reservationEventValidator,
    ],
    [
      'execution.work-cancelled.v1',
      CancellationEventConsumer,
      cancellationEventValidator,
    ],
    ['billing.payment-refunded.v1', RefundEventConsumer, refundEventValidator],
    [
      'execution.parts-released.v1',
      ReleaseEventConsumer,
      releaseEventValidator,
    ],
    ['billing.charge-failed.v1', FailureEventConsumer, failureEventValidator],
    ['billing.refund-blocked.v1', FailureEventConsumer, failureEventValidator],
  ] as const;
  it.each(cases)(
    '%s confirma após persistência e trata falhas e contrato inválido',
    async (name, Consumer, validator) => {
      const body = JSON.parse(
        readFileSync(resolve(directory, `examples/${name}.json`), 'utf8'),
      ) as { messageId: string; type: string };
      const handler = { execute: jest.fn().mockResolvedValue('PENDING') };
      const receiver = {
        completeMessage: jest.fn(),
        abandonMessage: jest.fn(),
        deadLetterMessage: jest.fn(),
      };
      const consumer = new Consumer(handler, validator(directory));
      const message = {
        body,
        messageId: body.messageId,
        subject: body.type,
      } as ServiceBusReceivedMessage;
      const broker = receiver as unknown as ServiceBusReceiver;
      await consumer.process(message, broker);
      expect(handler.execute).toHaveBeenCalledWith(body);
      expect(receiver.completeMessage).toHaveBeenCalledWith(message);
      await consumer.process({ ...message, subject: 'outro' }, broker);
      await consumer.process({ ...message, messageId: 'outro' }, broker);
      expect(receiver.deadLetterMessage).toHaveBeenCalledTimes(2);
      handler.execute.mockRejectedValueOnce(new Error('banco'));
      await consumer.process(message, broker);
      expect(receiver.abandonMessage).toHaveBeenCalledWith(message);
      receiver.completeMessage.mockRejectedValueOnce(new Error('ACK'));
      await expect(consumer.process(message, broker)).rejects.toThrow('ACK');
      expect(receiver.abandonMessage).toHaveBeenCalledTimes(1);
    },
  );
});

describe('consumidor de diagnóstico', () => {
  const directory = resolve(process.cwd(), 'docs/contracts/messages');
  const body = JSON.parse(
    readFileSync(
      resolve(directory, 'examples/execution.diagnosis-completed.v1.json'),
      'utf8',
    ),
  ) as { messageId: string };
  const handler = { execute: jest.fn().mockResolvedValue('PENDING') };
  const receiver = {
    completeMessage: jest.fn(),
    abandonMessage: jest.fn(),
    deadLetterMessage: jest.fn(),
  };
  const consumer = new DiagnosisEventConsumer(
    handler,
    diagnosisEventValidator(directory),
  );
  it('confirma após persistência e rejeita identificador divergente', async () => {
    await consumer.process(
      { body, messageId: body.messageId } as ServiceBusReceivedMessage,
      receiver as unknown as ServiceBusReceiver,
    );
    expect(handler.execute).toHaveBeenCalledWith(body);
    expect(receiver.completeMessage).toHaveBeenCalledTimes(1);
    await consumer.process(
      { body, messageId: 'wrong' } as ServiceBusReceivedMessage,
      receiver as unknown as ServiceBusReceiver,
    );
    expect(receiver.deadLetterMessage).toHaveBeenCalledTimes(1);
  });
});
