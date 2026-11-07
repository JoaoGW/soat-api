import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';

type Receiver = Pick<ServiceBusReceiver, 'completeMessage' | 'abandonMessage'>;

/** Não tenta outra liquidação depois que o resultado do ACK se torna incerto. */
export async function recoverWithSafeSettlement<T>(
  message: ServiceBusReceivedMessage,
  receiver: Receiver,
  action: (settlement: Pick<Receiver, 'completeMessage'>) => Promise<T>,
): Promise<T> {
  let completeAttempted = false;
  try {
    return await action({
      completeMessage: async (item) => {
        completeAttempted = true;
        await receiver.completeMessage(item);
      },
    });
  } catch (error) {
    if (!completeAttempted) {
      try {
        await receiver.abandonMessage(message);
      } catch {
        // O lock expira; preserve a falha original para o operador.
      }
    }
    throw error;
  }
}
