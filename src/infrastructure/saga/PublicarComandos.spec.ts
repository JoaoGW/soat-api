import { PrismaClient } from '@prisma/client';
import { DispatchCommands } from './PublicarComandos';

describe('publicação em lote da outbox', () => {
  const item = { messageId: 'm', type: 't', payload: {}, attemptCount: 4 };
  const now = new Date('2030-01-01T00:00:00Z');
  it('para ao esvaziar a outbox e informa que pode aguardar', async () => {
    const db = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ ...item, attemptCount: 0 }])
        .mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const publish = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new DispatchCommands(db as unknown as PrismaClient, {
      publish,
    });
    expect(await dispatcher.drain()).toEqual({ processed: 1, drained: true });
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('não sinaliza a Saga quando outro worker reassumiu a mensagem', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(0) };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([item]),
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const dispatcher = new DispatchCommands(db as unknown as PrismaClient, {
      publish: jest.fn().mockRejectedValue(new Error('broker')),
    });
    expect(await dispatcher.execute(now)).toBe('CLAIM_LOST');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it('sinaliza a Saga ao desistir da mensagem e mantém retentativas antes disso', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };
    const db = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ ...item, attemptCount: 1 }])
        .mockResolvedValueOnce([item]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const dispatcher = new DispatchCommands(db as unknown as PrismaClient, {
      publish: jest.fn().mockRejectedValue(new Error('broker')),
    });
    expect(await dispatcher.execute(now)).toBe('CLAIM_LOST');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(await dispatcher.execute(now)).toBe('FAILED');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    await expect(dispatcher.execute(new Date('x'))).rejects.toThrow(
      'Data inválida',
    );
  });
});
