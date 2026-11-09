import { ServiceBusReceivedMessage } from '@azure/service-bus';
import { recoverWithSafeSettlement } from './SafeDlqSettlement';

describe('liquidação segura da DLQ', () => {
  const message = { messageId: 'msg-1' } as ServiceBusReceivedMessage;
  const receiver = { completeMessage: jest.fn(), abandonMessage: jest.fn() };
  beforeEach(() => jest.resetAllMocks());

  it('confirma uma vez quando a recuperação é concluída', async () => {
    const result = await recoverWithSafeSettlement(
      message,
      receiver,
      async (settlement) => {
        await settlement.completeMessage(message);
        return 'APPLIED';
      },
    );
    expect(result).toBe('APPLIED');
    expect(receiver.completeMessage).toHaveBeenCalledTimes(1);
    expect(receiver.abandonMessage).not.toHaveBeenCalled();
  });
  it('abandona somente quando a falha ocorre antes de tentar o ACK', async () => {
    await expect(
      recoverWithSafeSettlement(message, receiver, async () => {
        throw new Error('handler');
      }),
    ).rejects.toThrow('handler');
    expect(receiver.abandonMessage).toHaveBeenCalledWith(message);
    expect(receiver.completeMessage).not.toHaveBeenCalled();
  });
  it('não abandona após falha com resultado de ACK incerto', async () => {
    receiver.completeMessage.mockRejectedValueOnce(new Error('ack incerto'));
    await expect(
      recoverWithSafeSettlement(message, receiver, async (settlement) =>
        settlement.completeMessage(message),
      ),
    ).rejects.toThrow('ack incerto');
    expect(receiver.abandonMessage).not.toHaveBeenCalled();
  });
  it('preserva o erro original mesmo se abandonar também falhar', async () => {
    receiver.abandonMessage.mockRejectedValueOnce(new Error('lock perdido'));
    await expect(
      recoverWithSafeSettlement(message, receiver, async () => {
        throw new Error('handler');
      }),
    ).rejects.toThrow('handler');
  });
});
