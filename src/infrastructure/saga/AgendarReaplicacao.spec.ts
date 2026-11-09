import { PrismaClient } from '@prisma/client';
import { ReplayPendingChargeEvents } from './ReaplicarCobrancas';
import { SagaReplayWorker } from './AgendarReaplicacao';

jest.mock('@prisma/client');
jest.mock('./ReaplicarCobrancas');

describe('SagaReplayWorker', () => {
  const original = process.env;
  const prisma = { $disconnect: jest.fn().mockResolvedValue(undefined) };
  const replay = { execute: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    process.env = { ...original };
    delete process.env.ENABLE_SAGA_REPLAY;
    delete process.env.SAGA_DATABASE_URL;
    jest
      .mocked(PrismaClient)
      .mockImplementation(() => prisma as unknown as PrismaClient);
    jest
      .mocked(ReplayPendingChargeEvents)
      .mockImplementation(() => replay as unknown as ReplayPendingChargeEvents);
    replay.execute.mockResolvedValue({
      applied: 0,
      pending: 0,
      errors: 0,
      next: null,
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env = original;
  });
  it('não conecta por padrão', async () => {
    const worker = new SagaReplayWorker();
    worker.onModuleInit();
    await worker.onApplicationShutdown();
    expect(PrismaClient).not.toHaveBeenCalled();
  });
  it('exige URL de banco independente quando habilitado', () => {
    process.env.ENABLE_SAGA_REPLAY = 'true';
    expect(() => new SagaReplayWorker().onModuleInit()).toThrow(
      'não configurada',
    );
    process.env.SAGA_DATABASE_URL = 'https://example.com';
    expect(() => new SagaReplayWorker().onModuleInit()).toThrow('inválida');
  });
  it('percorre páginas e agenda nova varredura, encerrando conexão', async () => {
    Object.assign(process.env, {
      ENABLE_SAGA_REPLAY: 'true',
      SAGA_DATABASE_URL: 'postgresql://test:test@localhost/os_test',
    });
    const cursor = { receivedAt: new Date('2030-01-01'), messageId: 'm1' };
    replay.execute.mockResolvedValueOnce({
      applied: 0,
      pending: 1,
      errors: 0,
      next: cursor,
    });
    const worker = new SagaReplayWorker();
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(replay.execute).toHaveBeenNthCalledWith(1, 50, undefined);
    expect(replay.execute).toHaveBeenNthCalledWith(2, 50, cursor);
    await worker.onApplicationShutdown();
    expect(prisma.$disconnect).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
