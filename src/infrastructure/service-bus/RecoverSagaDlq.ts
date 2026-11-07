import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
} from '@azure/service-bus';
import { MessageVerifier } from '../messaging/message-signature';

type Route = {
  validate: (body: unknown) => boolean;
  execute: (body: never) => Promise<'APPLIED' | 'PENDING'>;
};
type Receiver = Pick<ServiceBusReceiver, 'completeMessage'>;

/** Processes one specifically selected DLQ event through the normal Saga handler. */
export class RecoverSagaDlq {
  constructor(
    private readonly db: PrismaClient,
    private readonly verifiers: Record<string, MessageVerifier>,
    private readonly routes: Record<string, Route>,
  ) {}

  async execute(
    message: ServiceBusReceivedMessage,
    receiver: Receiver,
    input: { expectedMessageId: string; actorId: string; reason: string },
  ): Promise<'APPLIED' | 'PENDING'> {
    const body: unknown = message.body;
    if (
      !input ||
      ![input.expectedMessageId, input.actorId, input.reason].every(
        (v) => typeof v === 'string' && /^[a-z0-9_@.-]{1,128}$/i.test(v),
      ) ||
      !body ||
      typeof body !== 'object'
    )
      throw new Error('Entrada inválida');
    const event = body as Record<string, unknown>;
    const { type, producer, sagaId, messageId } = event;
    if (
      typeof type !== 'string' ||
      typeof producer !== 'string' ||
      typeof sagaId !== 'string' ||
      !/^[a-z0-9_-]{1,128}$/i.test(sagaId) ||
      messageId !== input.expectedMessageId ||
      message.messageId !== messageId ||
      message.subject !== type
    )
      throw new Error('Envelope não corresponde à mensagem selecionada');
    const verifier = this.verifiers[producer];
    const route = this.routes[type];
    if (
      !verifier?.verify(body, message.applicationProperties?.signature) ||
      !route?.validate(body)
    )
      throw new Error('Evento não autenticado ou incompatível');
    // Audit is durable before execution. A crash before ACK may repeat the
    // attempt; the handler inbox provides deduplication for the same message.
    await this.db
      .$executeRaw`INSERT INTO "SagaRecoveryAudit" ("id","sagaId","messageId","actorId","reason") VALUES (${randomUUID()},${sagaId},${input.expectedMessageId},${input.actorId},${input.reason})`;
    const result = await route.execute(body as never);
    if (result !== 'APPLIED' && result !== 'PENDING')
      throw new Error('Resultado inválido');
    const durable = await this.db.$queryRaw<
      Array<{ matches: boolean }>
    >`SELECT ("payload" = ${JSON.stringify(body)}::jsonb AND "status" IN ('APPLIED','PENDING')) AS "matches" FROM "Inbox" WHERE "consumer"='os.saga-events' AND "messageId"=${input.expectedMessageId}`;
    if (!durable[0]?.matches)
      throw new Error('Evento não foi persistido na inbox');
    await receiver.completeMessage(message);
    return result;
  }
}
