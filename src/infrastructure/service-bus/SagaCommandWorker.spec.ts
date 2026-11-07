import { generateKeyPairSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ServiceBusClient } from '@azure/service-bus';
import { DispatchCommands } from '../saga/PublicarComandos';
import { SagaCommandWorker } from './SagaCommandWorker';

jest.mock('@prisma/client');
jest.mock('@azure/identity');
jest.mock('@azure/service-bus');
jest.mock('../saga/PublicarComandos');

describe('publicador de comandos da Saga', () => {
  const original = process.env;
  const privateKey = generateKeyPairSync('ed25519')
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const billing = { sendMessages: jest.fn(), close: jest.fn() };
  const execution = { sendMessages: jest.fn(), close: jest.fn() };
  const bus = { createSender: jest.fn(), close: jest.fn() };
  const db = { $disconnect: jest.fn() };
  const dispatcher = { execute: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    process.env = {
      ...original,
      ENABLE_SAGA_COMMAND_PUBLISHER: 'true',
      SAGA_DATABASE_URL: 'postgresql://localhost/os_test',
      OS_MESSAGE_PRIVATE_KEY: privateKey,
      SERVICE_BUS_NAMESPACE: 'test.servicebus.windows.net',
      SERVICE_BUS_BILLING_QUEUE: 'billing',
      SERVICE_BUS_EXECUTION_QUEUE: 'execution',
      AZURE_TENANT_ID: 'tenant',
      AZURE_CLIENT_ID: 'client',
      AZURE_FEDERATED_TOKEN_FILE: '/test',
    };
    bus.createSender.mockImplementation((name: string) =>
      name === 'billing' ? billing : execution,
    );
    jest
      .mocked(PrismaClient)
      .mockImplementation(() => db as unknown as PrismaClient);
    jest
      .mocked(ServiceBusClient)
      .mockImplementation(() => bus as unknown as ServiceBusClient);
    jest
      .mocked(DispatchCommands)
      .mockImplementation(() => dispatcher as unknown as DispatchCommands);
  });
  afterEach(() => {
    process.env = original;
    jest.useRealTimers();
  });
  it('recusa configuração incompleta e filas iguais', () => {
    process.env.SERVICE_BUS_EXECUTION_QUEUE = 'billing';
    expect(() => new SagaCommandWorker().onModuleInit()).toThrow(
      'Configuração incompleta',
    );
    expect(ServiceBusClient).not.toHaveBeenCalled();
  });
  it('assina e roteia comandos, rejeita envelope ou destino inválido e encerra recursos', async () => {
    const worker = new SagaCommandWorker();
    worker.onModuleInit();
    const port = jest.mocked(DispatchCommands).mock.calls[0][1];
    const payload = {
      messageId: 'id',
      type: 'billing.create-charge.v1',
      producer: 'soat-os-service',
    };
    await port.publish({ messageId: 'id', type: payload.type, payload });
    expect(billing.sendMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'id',
        applicationProperties: { signature: expect.any(String) },
      }),
    );
    const cancellation = { ...payload, type: 'billing.cancel-charge.v1' };
    await port.publish({
      messageId: 'id',
      type: cancellation.type,
      payload: cancellation,
    });
    expect(billing.sendMessages).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'billing.cancel-charge.v1' }),
    );
    const executionPayload = { ...payload, type: 'execution.cancel-work.v1' };
    await port.publish({
      messageId: 'id',
      type: executionPayload.type,
      payload: executionPayload,
    });
    expect(execution.sendMessages).toHaveBeenCalledTimes(1);
    await expect(
      port.publish({ messageId: 'other', type: payload.type, payload }),
    ).rejects.toThrow('Envelope inválido');
    const unsupported = { ...payload, type: 'outro' };
    await expect(
      port.publish({
        messageId: 'id',
        type: unsupported.type,
        payload: unsupported,
      }),
    ).rejects.toThrow('Destino de comando desconhecido');
    await worker.onApplicationShutdown();
    expect(billing.close).toHaveBeenCalled();
    expect(execution.close).toHaveBeenCalled();
    expect(bus.close).toHaveBeenCalled();
    expect(db.$disconnect).toHaveBeenCalled();
  });
});
