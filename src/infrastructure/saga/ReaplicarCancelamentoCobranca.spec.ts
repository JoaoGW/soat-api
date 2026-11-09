import { ReplayPendingChargeEvents } from './ReaplicarCobrancas';

describe('reaplicação de cancelamento financeiro', () => {
  it('revalida e encaminha evento persistido ao handler adequado', async () => {
    const payload = { type: 'billing.charge-canceled.v1', messageId: 'm' };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          payload,
          type: payload.type,
          messageId: 'm',
          receivedAt: new Date(),
        },
      ]),
    };
    const charge = { execute: jest.fn() };
    const handler = { execute: jest.fn().mockResolvedValue('APPLIED') };
    const validate = jest.fn().mockReturnValue(true);
    const replay = Reflect.construct(ReplayPendingChargeEvents, [
      db,
      charge,
      () => true,
      ...Array(20).fill(undefined),
      handler,
      validate,
    ]) as ReplayPendingChargeEvents;
    expect(await replay.execute()).toMatchObject({
      applied: 1,
      pending: 0,
      errors: 0,
    });
    expect(validate).toHaveBeenCalledWith(payload);
    expect(handler.execute).toHaveBeenCalledWith(payload);
    expect(charge.execute).not.toHaveBeenCalled();
  });
});
