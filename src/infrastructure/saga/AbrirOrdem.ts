import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type Input = {
  actorId: string;
  key: string;
  clienteId: string;
  veiculoId: string;
  filialId: string;
  solicitacoes?: string[];
};
type Output = {
  id: string;
  sagaId: string;
  codigoAcompanhamento: string;
  status: string;
  dataCriacao: string;
};
const idOk = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value);

/** OS, histórico, Saga, operação e outbox são criados numa única transação. */
export class OpenOrderWithSaga {
  constructor(private readonly db: PrismaClient) {}
  async execute(input: Input, now = new Date()): Promise<Output> {
    if (
      !input ||
      ![
        input.actorId,
        input.key,
        input.clienteId,
        input.veiculoId,
        input.filialId,
      ].every(idOk) ||
      !Number.isFinite(now.getTime()) ||
      (input.solicitacoes !== undefined &&
        (!Array.isArray(input.solicitacoes) ||
          input.solicitacoes.length > 100 ||
          input.solicitacoes.some(
            (item) =>
              typeof item !== 'string' || !item.trim() || item.length > 500,
          )))
    )
      throw new BadRequestException('Dados da ordem inválidos');
    const requests = input.solicitacoes ?? [];
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          clienteId: input.clienteId,
          veiculoId: input.veiculoId,
          filialId: input.filialId,
          solicitacoes: requests,
        }),
      )
      .digest('hex');
    return this.db.$transaction(async (tx) => {
      const route = 'fase4.open-order';
      const lock = JSON.stringify([input.actorId, route, input.key]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
      const prior = await tx.$queryRaw<
        Array<{ requestHash: string; response: Output }>
      >`SELECT "requestHash", "response" FROM "IdempotencyRequest" WHERE "actorId" = ${input.actorId} AND "route" = ${route} AND "key" = ${input.key}`;
      if (prior[0]) {
        if (prior[0].requestHash !== requestHash)
          throw new ConflictException(
            'Chave idempotente reutilizada com dados diferentes',
          );
        return prior[0].response;
      }
      const customers = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Cliente" WHERE "id" = ${input.clienteId} AND "ativo" = true FOR SHARE`;
      if (!customers.length)
        throw new NotFoundException('Cliente não encontrado');
      const vehicles = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Veiculo" WHERE "id" = ${input.veiculoId} AND "clienteId" = ${input.clienteId} AND "ativo" = true FOR SHARE`;
      if (!vehicles.length)
        throw new NotFoundException('Veículo não encontrado para o cliente');
      const osId = randomUUID();
      const sagaId = randomUUID();
      const operationId = randomUUID();
      const messageId = randomUUID();
      const codigoAcompanhamento = randomBytes(12)
        .toString('hex')
        .toUpperCase();
      const type = 'execution.request-diagnosis.v1';
      const response: Output = {
        id: osId,
        sagaId,
        codigoAcompanhamento,
        status: 'RECEBIDA',
        dataCriacao: now.toISOString(),
      };
      const event = {
        messageId,
        type,
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        producer: 'soat-os-service',
        aggregateType: 'saga',
        aggregateId: sagaId,
        aggregateVersion: 1,
        osId,
        sagaId,
        filialId: input.filialId,
        correlationId: sagaId,
        causationId: input.key,
        operationId,
        data: {
          veiculoId: input.veiculoId,
          ...(requests.length ? { solicitacoes: requests } : {}),
        },
      };
      await tx.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "createdAt", "updatedAt") VALUES (${osId}, ${codigoAcompanhamento}, ${input.clienteId}, ${input.veiculoId}, ${input.filialId}, 'RECEBIDA', ${now}, ${now})`;
      await tx.$executeRaw`INSERT INTO "HistoricoStatusOS" ("id", "osId", "status", "ocorridoEm") VALUES (${randomUUID()}, ${osId}, 'RECEBIDA', ${now})`;
      await tx.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "version", "createdAt", "updatedAt") VALUES (${sagaId}, ${osId}, ${input.filialId}, 'DIAGNOSTICO_PENDENTE', 1, ${now}, ${now})`;
      await tx.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${operationId}, ${sagaId}, 'REQUEST_DIAGNOSIS', 1, ${type}, 'PENDING', ${now})`;
      await tx.$executeRaw`INSERT INTO "Outbox" ("messageId", "type", "payload") VALUES (${messageId}, ${type}, ${JSON.stringify(event)}::jsonb)`;
      await tx.$executeRaw`INSERT INTO "IdempotencyRequest" ("actorId", "route", "key", "requestHash", "statusCode", "response") VALUES (${input.actorId}, ${route}, ${input.key}, ${requestHash}, 201, ${JSON.stringify(response)}::jsonb)`;
      return response;
    });
  }
}
