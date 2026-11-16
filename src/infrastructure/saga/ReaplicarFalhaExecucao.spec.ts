import { ReplayPendingChargeEvents } from './ReaplicarCobrancas';

describe('reaplicação de falha na execução', () => {
  const payload = { type: 'execution.work-failed.v1', messageId: 'm' };
  const row = {
    payload,
    type: payload.type,
    messageId: 'm',
    receivedAt: new Date(),
  };
  const build = (handler?: object, validate?: (event: unknown) => boolean) =>
    Reflect.construct(ReplayPendingChargeEvents, [
      { $queryRaw: jest.fn().mockResolvedValue([row]) },
      { execute: jest.fn() },
      () => true,
      ...Array(22).fill(undefined),
      handler,
      validate,
    ]) as ReplayPendingChargeEvents;

  it('revalida o contrato e encaminha ao receptor de falhas de execução', async () => {
    const handler = { execute: jest.fn().mockResolvedValue('PENDING') };
    const validate = jest.fn().mockReturnValue(true);
    expect(await build(handler, validate).execute()).toMatchObject({
      applied: 0,
      pending: 1,
      errors: 0,
    });
    expect(validate).toHaveBeenCalledWith(payload);
    expect(handler.execute).toHaveBeenCalledWith(payload);
  });

  it('conta como erro o evento inválido ou sem receptor configurado', async () => {
    const handler = { execute: jest.fn() };
    expect(await build(handler, () => false).execute()).toMatchObject({
      errors: 1,
    });
    expect(await build().execute()).toMatchObject({ errors: 1 });
    expect(handler.execute).not.toHaveBeenCalled();
  });
});
