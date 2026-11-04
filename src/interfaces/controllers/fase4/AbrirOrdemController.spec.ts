import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';
import { OpenOrderController, OpenOrderRuntime } from './AbrirOrdemController';

describe('ações administrativas da Fase 4', () => {
  const runtime = {
    deliver: jest.fn(),
    retry: jest.fn(),
    recoverLatePayment: jest.fn(),
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
});
