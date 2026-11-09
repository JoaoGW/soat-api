import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { forwardTrace } from '../observability/TraceContext';

type Item = {
  sourceId: string;
  itemType: 'PART' | 'SERVICE';
  quantity: number;
  unitPriceInCents: number;
};
export type DiagnosisEvent = {
  messageId: string;
  operationId: string;
  sagaId: string;
  osId: string;
  filialId: string;
  correlationId: string;
  traceparent?: string;
  tracestate?: string;
  type: 'execution.diagnosis-started.v1' | 'execution.diagnosis-completed.v1';
  producer: 'soat-execution-service';
  data: { diagnosisId: string; diagnosisVersion: number; items?: Item[] };
};
type Saga = {
  osId: string;
  filialId: string;
  status: string;
  version: number;
  clienteId: string;
  contato: string;
};

/** A identidade do produtor e o contrato devem ser validados pelo transporte. */
export class ReceiveDiagnosisEvent {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    event: DiagnosisEvent,
    now = new Date(),
  ): Promise<'APPLIED' | 'PENDING'> {
    const started = event?.type === 'execution.diagnosis-started.v1';
    const completed = event?.type === 'execution.diagnosis-completed.v1';
    if (
      (!started && !completed) ||
      event?.producer !== 'soat-execution-service' ||
      ![
        event?.messageId,
        event?.operationId,
        event?.sagaId,
        event?.osId,
        event?.filialId,
        event?.correlationId,
        event?.data?.diagnosisId,
      ].every((id) => typeof id === 'string' && id.length > 0) ||
      event.data.diagnosisId !== event.osId ||
      !Number.isSafeInteger(event.data.diagnosisVersion) ||
      event.data.diagnosisVersion !== (started ? 2 : 3) ||
      !Number.isFinite(now.getTime())
    )
      throw new Error('Diagnóstico inválido');
    const items = event.data.items;
    if (
      completed &&
      (!Array.isArray(items) ||
        !items.length ||
        items.length > 20 ||
        items.some(
          (item) =>
            !item ||
            typeof item.sourceId !== 'string' ||
            !item.sourceId ||
            !['PART', 'SERVICE'].includes(item.itemType) ||
            !Number.isSafeInteger(item.quantity) ||
            item.quantity < 1 ||
            !Number.isSafeInteger(item.unitPriceInCents) ||
            item.unitPriceInCents < 0,
        ) ||
        !Number.isSafeInteger(
          items.reduce(
            (sum, item) => sum + item.quantity * item.unitPriceInCents,
            0,
          ),
        ) ||
        items.reduce(
          (sum, item) => sum + item.quantity * item.unitPriceInCents,
          0,
        ) > 2147483647)
    )
      throw new Error('Itens de diagnóstico inválidos');
    const encoded = JSON.stringify(event);
    const consumer = 'os.saga-events';
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Saga[]
      >`SELECT s."osId", s."filialId", s."status", s."version", o."clienteId", c."contato" FROM "SagaInstance" s JOIN "OrdemDeServico" o ON o."id" = s."osId" JOIN "Cliente" c ON c."id" = o."clienteId" WHERE s."id" = ${event.sagaId} FOR UPDATE OF s`;
      const saga = rows[0];
      if (!saga || saga.osId !== event.osId || saga.filialId !== event.filialId)
        throw new Error('Saga não corresponde ao diagnóstico');
      const requests = await tx.$queryRaw<
        Array<{ operationId: string; status: string }>
      >`SELECT "operationId", "status" FROM "SagaOperation" WHERE "sagaId" = ${event.sagaId} AND "commandType" = 'execution.request-diagnosis.v1'`;
      if (
        requests.length !== 1 ||
        !['PENDING', 'SENT', 'SUCCEEDED'].includes(requests[0].status)
      )
        throw new Error('Solicitação de diagnóstico não encontrada');
      await tx.$executeRaw`INSERT INTO "Inbox" ("consumer", "messageId", "operationId", "type", "payload", "status") VALUES (${consumer}, ${event.messageId}, ${event.operationId}, ${event.type}, ${encoded}::jsonb, 'PENDING') ON CONFLICT DO NOTHING`;
      const inbox = await tx.$queryRaw<
        Array<{ matches: boolean; status: string }>
      >`SELECT ("operationId" = ${event.operationId} AND "type" = ${event.type} AND "payload" = ${encoded}::jsonb) AS "matches", "status" FROM "Inbox" WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      if (!inbox[0]?.matches)
        throw new Error('Mensagem reutilizada com outro conteúdo');
      if (inbox[0].status === 'APPLIED') return 'APPLIED';
      const previous = await tx.$queryRaw<
        Array<{ matches: boolean }>
      >`SELECT ("payload"->'data' = ${JSON.stringify(event.data)}::jsonb) AS "matches" FROM "Inbox" WHERE "consumer" = ${consumer} AND "type" = ${event.type} AND "status" = 'APPLIED' AND "payload"->>'sagaId' = ${event.sagaId}`;
      if (previous.length) {
        if (!previous.every((row) => row.matches))
          throw new Error('Diagnóstico divergente');
        await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
        return 'APPLIED';
      }
      if (saga.status !== 'DIAGNOSTICO_PENDENTE') return 'PENDING';
      if (completed) {
        const starts = await tx.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT COUNT(*) AS count FROM "Inbox" WHERE "consumer" = ${consumer} AND "type" = 'execution.diagnosis-started.v1' AND "status" = 'APPLIED' AND "payload"->>'sagaId' = ${event.sagaId}`;
        if (!Number(starts[0]?.count)) return 'PENDING';
        if (!saga.contato) throw new Error('Contato do cliente ausente');
        const operationId = randomUUID();
        const messageId = randomUUID();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const type = 'billing.generate-quote.v1';
        const payload = {
          messageId,
          type,
          schemaVersion: 1,
          occurredAt: now.toISOString(),
          producer: 'soat-os-service',
          aggregateType: 'saga',
          aggregateId: event.sagaId,
          aggregateVersion: saga.version + 1,
          osId: event.osId,
          sagaId: event.sagaId,
          filialId: event.filialId,
          correlationId: event.correlationId,
          ...forwardTrace(event),
          causationId: event.messageId,
          operationId,
          data: {
            clienteId: saga.clienteId,
            contato: saga.contato,
            diagnosisId: event.data.diagnosisId,
            diagnosisVersion: event.data.diagnosisVersion,
            items,
            expiresAt: expiresAt.toISOString(),
          },
        };
        await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${event.sagaId}, 'GENERATE_QUOTE', 1, ${type}, 'PENDING', NOW())`;
        await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb)`;
        await tx.$executeRaw`UPDATE "SagaOperation" SET "status" = 'SUCCEEDED', "result" = ${encoded}::jsonb, "updatedAt" = NOW() WHERE "operationId" = ${requests[0].operationId}`;
        await tx.$executeRaw`UPDATE "SagaInstance" SET "status" = 'ORCAMENTO_PENDENTE', "deadlineAt" = ${expiresAt}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.sagaId}`;
      } else {
        await tx.$executeRaw`UPDATE "OrdemDeServico" SET "status" = 'EM_DIAGNOSTICO', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = ${event.osId}`;
        await tx.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id", "osId", "status", "ocorridoEm") VALUES (${randomUUID()}, ${event.osId}, 'EM_DIAGNOSTICO', ${now})`;
      }
      await tx.$executeRaw`UPDATE "Inbox" SET "status" = 'APPLIED', "appliedAt" = NOW() WHERE "consumer" = ${consumer} AND "messageId" = ${event.messageId}`;
      return 'APPLIED';
    });
  }
}
