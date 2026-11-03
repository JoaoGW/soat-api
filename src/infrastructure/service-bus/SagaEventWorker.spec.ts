import { generateKeyPairSync } from 'node:crypto';
import { MessageSigner } from '../messaging/message-signature';
import { PrismaClient } from '@prisma/client';
import { WorkloadIdentityCredential } from '@azure/identity';
import { ServiceBusClient } from '@azure/service-bus';
import { ChargeEventConsumer } from './ChargeEventConsumer';
import { PaymentEventConsumer } from './PaymentEventConsumer';
import { WorkEnqueuedEventConsumer } from './WorkEnqueuedEventConsumer';
import { SagaEventWorker } from './SagaEventWorker';

jest.mock('@prisma/client');
jest.mock('@azure/identity');
jest.mock('@azure/service-bus');
jest.mock('./ChargeEventConsumer', () => ({
  ChargeEventConsumer: jest.fn(),
  chargeEventValidator: jest.fn(() => () => true),
}));
jest.mock('./PaymentEventConsumer', () => ({
  PaymentEventConsumer: jest.fn(),
  paymentEventValidator: jest.fn(() => () => true),
}));
jest.mock('./WorkEnqueuedEventConsumer', () => ({
  WorkEnqueuedEventConsumer: jest.fn(),
  workEnqueuedEventValidator: jest.fn(() => () => true),
}));

describe('SagaEventWorker', () => {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const signer = new MessageSigner(
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  );
  const signed = (type: string, producer: string) => {
    const body = { type, producer };
    return { body, applicationProperties: { signature: signer.sign(body) } };
  };
  const original = process.env;
  const subscription = { close: jest.fn().mockResolvedValue(undefined) };
  const receiver = {
    subscribe: jest.fn(),
    abandonMessage: jest.fn().mockResolvedValue(undefined),
    deadLetterMessage: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const bus = {
    createReceiver: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const db = { $disconnect: jest.fn().mockResolvedValue(undefined) };
  const charge = { process: jest.fn().mockResolvedValue(undefined) };
  const payment = { process: jest.fn().mockResolvedValue(undefined) };
  const work = { process: jest.fn().mockResolvedValue(undefined) };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...original,
      BILLING_MESSAGE_PUBLIC_KEY: publicKey,
      EXECUTION_MESSAGE_PUBLIC_KEY: publicKey,
    };
    delete process.env.ENABLE_SAGA_EVENT_CONSUMER;
    receiver.subscribe.mockReturnValue(subscription);
    bus.createReceiver.mockReturnValue(receiver);
    jest
      .mocked(PrismaClient)
      .mockImplementation(() => db as unknown as PrismaClient);
    jest
      .mocked(ServiceBusClient)
      .mockImplementation(() => bus as unknown as ServiceBusClient);
    jest
      .mocked(ChargeEventConsumer)
      .mockImplementation(() => charge as unknown as ChargeEventConsumer);
    jest
      .mocked(PaymentEventConsumer)
      .mockImplementation(() => payment as unknown as PaymentEventConsumer);
    jest
      .mocked(WorkEnqueuedEventConsumer)
      .mockImplementation(() => work as unknown as WorkEnqueuedEventConsumer);
  });
  afterEach(() => {
    process.env = original;
  });
  it('não conecta por padrão', async () => {
    const worker = new SagaEventWorker();
    worker.onModuleInit();
    await worker.onApplicationShutdown();
    expect(ServiceBusClient).not.toHaveBeenCalled();
    expect(PrismaClient).not.toHaveBeenCalled();
  });
  it('falha ao habilitar sem configuração', () => {
    process.env.ENABLE_SAGA_EVENT_CONSUMER = 'true';
    delete process.env.SAGA_DATABASE_URL;
    expect(() => new SagaEventWorker().onModuleInit()).toThrow(
      'Configuração incompleta',
    );
  });
  it('roteia eventos suportados e não confirma os demais', async () => {
    Object.assign(process.env, {
      ENABLE_SAGA_EVENT_CONSUMER: 'true',
      SAGA_DATABASE_URL: 'postgresql://test:test@localhost/os_test',
      SERVICE_BUS_NAMESPACE: 'example.servicebus.windows.net',
      SERVICE_BUS_EVENT_TOPIC: 'events',
      SERVICE_BUS_SAGA_SUBSCRIPTION: 'os.saga-events',
      AZURE_TENANT_ID: 'tenant',
      AZURE_CLIENT_ID: 'client',
      AZURE_FEDERATED_TOKEN_FILE: '/tmp/token',
    });
    const worker = new SagaEventWorker();
    worker.onModuleInit();
    expect(WorkloadIdentityCredential).toHaveBeenCalled();
    expect(receiver.subscribe).toHaveBeenCalledWith(expect.any(Object), {
      autoCompleteMessages: false,
      maxConcurrentCalls: 1,
    });
    const handlers = receiver.subscribe.mock.calls[0][0] as {
      processMessage(message: unknown): Promise<void>;
    };
    const a = signed('billing.charge-created.v1', 'soat-billing-service');
    const b = signed('billing.payment-confirmed.v1', 'soat-billing-service');
    const c = signed('execution.work-enqueued.v1', 'soat-execution-service');
    const d = signed('billing.unknown.v1', 'soat-billing-service');
    await handlers.processMessage(a);
    await handlers.processMessage(b);
    await handlers.processMessage(c);
    await handlers.processMessage(d);
    const forged = signed(
      'billing.payment-confirmed.v1',
      'soat-billing-service',
    );
    forged.body.type = 'billing.charge-created.v1';
    await handlers.processMessage(forged);
    expect(receiver.deadLetterMessage).toHaveBeenCalledWith(
      forged,
      expect.objectContaining({ deadLetterReason: 'UnauthenticatedProducer' }),
    );
    expect(charge.process).toHaveBeenCalledWith(a, receiver);
    expect(payment.process).toHaveBeenCalledWith(b, receiver);
    expect(work.process).toHaveBeenCalledWith(c, receiver);
    expect(receiver.abandonMessage).toHaveBeenCalledWith(d);
    await worker.onApplicationShutdown();
    expect(subscription.close).toHaveBeenCalled();
    expect(receiver.close).toHaveBeenCalled();
    expect(bus.close).toHaveBeenCalled();
    expect(db.$disconnect).toHaveBeenCalled();
  });
});
