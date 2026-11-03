import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
export class StartCompensation {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    sagaId: string,
    reason: string,
    now = new Date(),
  ): Promise<'STARTED' | 'RECONCILIACAO_NECESSARIA'> {
    if (
      ![sagaId, reason].every(
        (id) => typeof id === 'string' && /^[a-z0-9_-]{1,128}$/i.test(id),
      ) ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Compensação inválida');
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          osId: string;
          filialId: string;
          status: string;
          version: number;
          executionId: string | null;
        }>
      >`SELECT "id", "osId", "filialId", "status", "version", "executionId" FROM "SagaInstance" WHERE "id" = ${sagaId} FOR UPDATE`;
      const saga = rows[0];
      if (!saga) throw new Error('Saga inexistente');
      if (saga.status === 'COMPENSANDO') return 'STARTED';
      if (saga.status === 'RECONCILIACAO_NECESSARIA')
        return 'RECONCILIACAO_NECESSARIA';
      if (
        ['EM_EXECUCAO', 'CONCLUIDA', 'RECONCILIACAO_NECESSARIA'].includes(
          saga.status,
        )
      ) {
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${sagaId}`;
        return 'RECONCILIACAO_NECESSARIA';
      }
      if (
        ![
          'DIAGNOSTICO_PENDENTE',
          'ORCAMENTO_PENDENTE',
          'AGUARDANDO_APROVACAO',
          'RESERVA_PENDENTE',
          'COBRANCA_PENDENTE',
          'AGUARDANDO_PAGAMENTO',
          'FILA_PENDENTE',
          'NA_FILA',
        ].includes(saga.status)
      )
        throw new Error('Saga não pode iniciar compensação');
      const operationId = randomUUID();
      const messageId = randomUUID();
      const type = 'execution.cancel-work.v1';
      const payload = {
        messageId,
        type,
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        producer: 'soat-os-service',
        aggregateType: 'saga',
        aggregateId: saga.id,
        aggregateVersion: saga.version + 1,
        osId: saga.osId,
        sagaId: saga.id,
        filialId: saga.filialId,
        correlationId: saga.id,
        causationId: operationId,
        operationId,
        data: {
          reason,
          ...(saga.executionId ? { executionId: saga.executionId } : {}),
        },
      };
      await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${saga.id}, 'CANCEL_WORK', 1, ${type}, 'PENDING', NOW())`;
      await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
      await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'COMPENSANDO', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${sagaId}`;
      return 'STARTED';
    });
  }
}
