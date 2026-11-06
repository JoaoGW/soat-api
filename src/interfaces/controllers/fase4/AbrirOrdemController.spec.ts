import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';
import { OpenOrderController, OpenOrderRuntime } from './AbrirOrdemController';

describe('ações administrativas da Fase 4', () => {
  const runtime = {
    execute: jest.fn(),
    compensate: jest.fn(),
    deliver: jest.fn(),
    retry: jest.fn(),
    recoverLatePayment: jest.fn(),
    recoverCompletedRepair: jest.fn(),
  };
  const controller = new OpenOrderController(
    runtime as unknown as OpenOrderRuntime,
  );
  beforeEach(() => jest.clearAllMocks());
  it('mantém as rotas protegidas pelo guard administrativo', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OpenOrderController)).toContain(
      JwtAuthGuard,
    );
  });
  it('exige ator e chave idempotente para abrir OS e rejeita campos inesperados', async () => {
    const body = {
      clienteId: 'cliente',
      veiculoId: 'veiculo',
      filialId: 'filial',
    };
    runtime.execute.mockResolvedValue({ id: 'os-1' });
    await expect(
      controller.open({ user: { username: 'admin' } }, 'chave', body),
    ).resolves.toEqual({ id: 'os-1' });
    expect(runtime.execute).toHaveBeenCalledWith('admin', 'chave', body);
    await expect(controller.open({}, 'chave', body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.open({ user: { username: 'admin' } }, undefined, body),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.open({ user: { username: 'admin' } }, 'chave', {
        ...body,
        extra: true,
      } as typeof body),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(runtime.execute).toHaveBeenCalledTimes(1);
  });
  it('não permite compensação sem motivo e identificador válidos', async () => {
    runtime.compensate.mockResolvedValue('STARTED');
    await expect(
      controller.compensate('saga-1', { reason: 'STEP_FAILED' }),
    ).resolves.toEqual({ status: 'STARTED' });
    for (const body of [
      null,
      [],
      {},
      { reason: 'invalido!' },
      { reason: 'OK', extra: true },
    ]) {
      await expect(
        controller.compensate('saga-1', body as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      controller.compensate('../saga', { reason: 'OK' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(runtime.compensate).toHaveBeenCalledTimes(1);
  });
  it('entrega apenas com identificador válido', async () => {
    runtime.deliver.mockResolvedValue('ENTREGUE');
    await expect(controller.deliver('os-1')).resolves.toEqual({
      status: 'ENTREGUE',
    });
    await expect(controller.deliver('../invalid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(runtime.deliver).toHaveBeenCalledTimes(1);
  });
  it('registra o ator autenticado no reprocessamento e recusa campos extras', async () => {
    const request = { user: { username: 'admin' } };
    await expect(
      controller.retry(request, 'saga-1', 'message-1', {
        reason: 'BROKER_RESTORED',
      }),
    ).resolves.toEqual({ status: 'PENDING', messageId: 'message-1' });
    expect(runtime.retry).toHaveBeenCalledWith({
      sagaId: 'saga-1',
      messageId: 'message-1',
      actorId: 'admin',
      reason: 'BROKER_RESTORED',
    });
    await expect(
      controller.retry(request, 'saga-1', 'message-1', {
        reason: 'X',
        extra: 'Y',
      } as { reason: string }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('encaminha recuperação financeira com ator autenticado e motivo compatível com o comando', async () => {
    const request = { user: { username: 'admin@example.test' } };
    runtime.recoverLatePayment.mockResolvedValue('STARTED');
    await expect(
      controller.recoverLatePayment(request, 'saga-1', {
        reason: 'LATE_PAYMENT',
      }),
    ).resolves.toEqual({ status: 'STARTED' });
    expect(runtime.recoverLatePayment).toHaveBeenCalledWith({
      sagaId: 'saga-1',
      actorId: request.user.username,
      reason: 'LATE_PAYMENT',
    });
    await expect(
      controller.recoverLatePayment(request, 'saga-1', {
        reason: 'invalid.reason',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('protege e valida a reconciliação de reparo', async () => {
    runtime.recoverCompletedRepair.mockResolvedValue('CONCLUIDA');
    await expect(
      controller.recoverCompletedRepair(
        { user: { username: 'admin' } },
        'saga-1',
        { reason: 'REPAIR_CONFIRMED' },
      ),
    ).resolves.toEqual({ status: 'CONCLUIDA' });
    await expect(
      controller.recoverCompletedRepair(
        { user: { username: 'admin' } },
        'saga-1',
        { reason: 'invalid.reason' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('chaves de ativação das operações da Fase 4', () => {
  it('mantém operações indisponíveis por padrão, mesmo com URL de banco', async () => {
    const original = process.env;
    process.env = {
      ...original,
      SAGA_DATABASE_URL: 'postgresql://localhost/test',
    };
    for (const key of [
      'ENABLE_FASE4_OPEN',
      'ENABLE_FASE4_COMPENSATION',
      'ENABLE_FASE4_DELIVERY',
      'ENABLE_FASE4_RECOVERY',
    ])
      delete process.env[key];
    try {
      const runtime = new OpenOrderRuntime();
      await expect(
        runtime.execute('a', 'k', {
          clienteId: 'c',
          veiculoId: 'v',
          filialId: 'f',
        }),
      ).rejects.toMatchObject({ status: 503 });
      await expect(runtime.compensate('s', 'motivo')).rejects.toMatchObject({
        status: 503,
      });
      await expect(runtime.deliver('os')).rejects.toMatchObject({
        status: 503,
      });
      await expect(
        runtime.retry({
          sagaId: 's',
          messageId: 'm',
          actorId: 'a',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        runtime.recoverLatePayment({ sagaId: 's', actorId: 'a', reason: 'r' }),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        runtime.recoverCompletedRepair({
          sagaId: 's',
          actorId: 'a',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ status: 503 });
      await runtime.onApplicationShutdown();
    } finally {
      process.env = original;
    }
  });
});
