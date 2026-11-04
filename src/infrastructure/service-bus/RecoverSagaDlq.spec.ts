import { generateKeyPairSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import { MessageSigner, MessageVerifier } from '../messaging/message-signature';
import { RecoverSagaDlq } from './RecoverSagaDlq';

describe('recuperação da DLQ da Saga', () => {
  const keys = generateKeyPairSync('ed25519');
  const signer = new MessageSigner(
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  );
  const verifier = new MessageVerifier(
    keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    'soat-billing-service',
  );
  const db = { $executeRaw: jest.fn(), $queryRaw: jest.fn() };
  const receiver = { completeMessage: jest.fn(), abandonMessage: jest.fn() };
  const handler = jest.fn();
  const body = {
    type: 'billing.quote-failed.v1',
    producer: 'soat-billing-service',
    messageId: 'msg-1',
    sagaId: 'saga-1',
  };
  const msg = {
    messageId: body.messageId,
    subject: body.type,
    body,
    applicationProperties: { signature: signer.sign(body) },
  } as unknown as ServiceBusReceivedMessage;
  const input = {
    expectedMessageId: 'msg-1',
    actorId: 'admin',
    reason: 'CONTRACT_FIXED',
  };
  const service = () =>
    new RecoverSagaDlq(
      db as unknown as PrismaClient,
      { 'soat-billing-service': verifier },
      { [body.type]: { validate: () => true, execute: handler } },
    );
  beforeEach(() => {
    jest.clearAllMocks();
    handler.mockResolvedValue('APPLIED');
    db.$executeRaw.mockResolvedValue(1);
    db.$queryRaw.mockResolvedValue([{ matches: true }]);
    receiver.completeMessage.mockResolvedValue(undefined);
  });
  it('audita, aplica e confirma somente após persistência na inbox', async () => {
    await expect(
      service().execute(msg, receiver as unknown as ServiceBusReceiver, input),
    ).resolves.toBe('APPLIED');
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(body);
    expect(receiver.completeMessage).toHaveBeenCalledWith(msg);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      receiver.completeMessage.mock.invocationCallOrder[0],
    );
  });
  it('rejeita mensagem diferente ou assinatura adulterada sem tocar a inbox', async () => {
    await expect(
      service().execute(msg, receiver as unknown as ServiceBusReceiver, {
        ...input,
        expectedMessageId: 'other',
      }),
    ).rejects.toThrow();
    const forged = { ...msg, body: { ...body, sagaId: 'other' } };
    await expect(
      service().execute(
        forged,
        receiver as unknown as ServiceBusReceiver,
        input,
      ),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
    expect(receiver.completeMessage).not.toHaveBeenCalled();
  });
  it('não confirma quando a aplicação ou a persistência falha', async () => {
    handler.mockRejectedValueOnce(new Error('database'));
    await expect(
      service().execute(msg, receiver as unknown as ServiceBusReceiver, input),
    ).rejects.toThrow('database');
    handler.mockResolvedValueOnce('PENDING');
    db.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service().execute(msg, receiver as unknown as ServiceBusReceiver, input),
    ).rejects.toThrow('inbox');
    expect(receiver.completeMessage).not.toHaveBeenCalled();
  });
});
