import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/** Reenvia a mesma mensagem, nunca cria uma nova operação de negócio. */
export class RetryFailedCommand {
  constructor(private readonly db: PrismaClient) {}
  async execute(input: {
    sagaId: string;
    messageId: string;
    actorId: string;
    reason: string;
  }): Promise<void> {
    if (
      ![input.sagaId, input.messageId, input.actorId, input.reason].every(
        (value) =>
          typeof value === 'string' && /^[a-z0-9_@.-]{1,128}$/i.test(value),
      )
    )
      throw new Error('Dados de recuperação inválidos');
    await this.db.$transaction(async (tx) => {
      const saga = await tx.$queryRaw<
        Array<{ status: string; requiresAttention: boolean }>
      >`SELECT "status", "requiresAttention" FROM "SagaInstance" WHERE "id" = ${input.sagaId} FOR UPDATE`;
      if (
        saga.length !== 1 ||
        saga[0].requiresAttention ||
        ![
          'DIAGNOSTICO_PENDENTE',
          'ORCAMENTO_PENDENTE',
          'AGUARDANDO_APROVACAO',
          'RESERVA_PENDENTE',
          'COBRANCA_PENDENTE',
          'AGUARDANDO_PAGAMENTO',
          'FILA_PENDENTE',
          'NA_FILA',
          'COMPENSANDO',
          'REEMBOLSO_PENDENTE',
          'LIBERACAO_PENDENTE',
        ].includes(saga[0].status)
      )
        throw new Error('Saga não permite reprocessamento');
      const rows = await tx.$queryRaw<
        Array<{ status: string; operationStatus: string; type: string }>
      >`
        SELECT o."status", o."type", op."status" AS "operationStatus" FROM "Outbox" o
        JOIN "SagaOperation" op ON op."operationId" = o."payload"->>'operationId' AND op."sagaId" = ${input.sagaId} AND op."commandType" = o."type"
        WHERE o."messageId" = ${input.messageId} AND o."payload"->>'sagaId' = ${input.sagaId}
          AND o."payload"->>'messageId' = o."messageId" AND o."payload"->>'type' = o."type" FOR UPDATE OF o, op`;
      if (
        rows.length !== 1 ||
        rows[0].status !== 'FAILED' ||
        !['PENDING', 'SENT'].includes(rows[0].operationStatus)
      )
        throw new Error('Comando não permite reprocessamento');
      const allowed: Record<string, string> = {
        'execution.request-diagnosis.v1': 'DIAGNOSTICO_PENDENTE',
        'billing.generate-quote.v1': 'ORCAMENTO_PENDENTE',
        'execution.reserve-parts.v1': 'RESERVA_PENDENTE',
        'billing.create-charge.v1': 'COBRANCA_PENDENTE',
        'execution.enqueue-work.v1': 'FILA_PENDENTE',
        'execution.cancel-work.v1': 'COMPENSANDO',
        'billing.refund-payment.v1': 'REEMBOLSO_PENDENTE',
        'execution.release-parts.v1': 'LIBERACAO_PENDENTE',
      };
      if (allowed[rows[0].type] !== saga[0].status)
        throw new Error('Comando incompatível com o estado da Saga');
      await tx.$executeRaw`UPDATE "Outbox" SET "status" = 'PENDING', "attemptCount" = 0, "nextAttemptAt" = NOW(), "claimUntil" = NULL, "claimOwner" = NULL WHERE "messageId" = ${input.messageId}`;
      await tx.$executeRaw`INSERT INTO "SagaRecoveryAudit" ("id", "sagaId", "messageId", "actorId", "reason") VALUES (${randomUUID()}, ${input.sagaId}, ${input.messageId}, ${input.actorId}, ${input.reason})`;
    });
  }
}
