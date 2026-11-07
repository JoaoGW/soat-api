import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
const idOk = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value);
function validate(page: number, limit: number) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new BadRequestException('Paginação inválida');
}
export class Phase4OrderQueries {
  constructor(private readonly db: PrismaClient) {}
  async operationalQueue(input: {
    page: number;
    limit: number;
    filialId?: string;
    status?: string;
  }) {
    validate(input.page, input.limit);
    if (
      [input.filialId, input.status].some(
        (value) => value !== undefined && !idOk(value),
      )
    )
      throw new BadRequestException('Filtro inválido');
    const branch = input.filialId ?? null,
      status = input.status ?? null,
      offset = (input.page - 1) * input.limit;
    const items = await this.db.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT o."id",o."codigoAcompanhamento",o."clienteId",o."veiculoId",o."filialId",o."status",o."createdAt",s."status" AS "sagaStatus",s."requiresAttention" FROM "OrdemDeServico" o LEFT JOIN "SagaInstance" s ON s."osId"=o."id" WHERE o."status" IN ('EM_EXECUCAO','AGUARDANDO_APROVACAO','EM_DIAGNOSTICO','RECEBIDA') AND (${branch}::text IS NULL OR o."filialId"=${branch}) AND (${status}::text IS NULL OR o."status"=${status}) ORDER BY CASE o."status" WHEN 'EM_EXECUCAO' THEN 1 WHEN 'AGUARDANDO_APROVACAO' THEN 2 WHEN 'EM_DIAGNOSTICO' THEN 3 ELSE 4 END,o."createdAt",o."id" LIMIT ${input.limit} OFFSET ${offset}`;
    return { items, page: input.page, limit: input.limit };
  }
  async list(input: {
    page: number;
    limit: number;
    clienteId?: string;
    filialId?: string;
    status?: string;
  }) {
    validate(input.page, input.limit);
    if (
      [input.clienteId, input.filialId, input.status].some(
        (value) => value !== undefined && !idOk(value),
      )
    )
      throw new BadRequestException('Filtro inválido');
    const customer = input.clienteId ?? null,
      branch = input.filialId ?? null,
      status = input.status ?? null,
      offset = (input.page - 1) * input.limit;
    const items = await this.db.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT o."id",o."codigoAcompanhamento",o."clienteId",o."veiculoId",o."filialId",o."status",o."quoteId",o."quoteVersion",o."executionId",o."dataInicioExecucao",o."dataFinalizacao",o."createdAt",o."updatedAt" FROM "OrdemDeServico" o JOIN "Cliente" c ON c."id"=o."clienteId" WHERE (${customer}::text IS NULL OR (o."clienteId"=${customer} AND c."ativo"=true)) AND (${branch}::text IS NULL OR o."filialId"=${branch}) AND (${status}::text IS NULL OR o."status"=${status}) ORDER BY o."createdAt" DESC,o."id" DESC LIMIT ${input.limit} OFFSET ${offset}`;
    return { items, page: input.page, limit: input.limit };
  }
  async get(id: string, clienteId?: string) {
    if (!idOk(id) || (clienteId !== undefined && !idOk(clienteId)))
      throw new BadRequestException('Identificador inválido');
    const customer = clienteId ?? null;
    const rows = await this.db.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT o."id",o."codigoAcompanhamento",o."clienteId",o."veiculoId",o."filialId",o."status",o."quoteId",o."quoteVersion",o."executionId",o."dataInicioExecucao",o."dataFinalizacao",o."createdAt",o."updatedAt" FROM "OrdemDeServico" o JOIN "Cliente" c ON c."id"=o."clienteId" WHERE o."id"=${id} AND (${customer}::text IS NULL OR (o."clienteId"=${customer} AND c."ativo"=true))`;
    if (!rows.length) throw new NotFoundException('Ordem não encontrada');
    return rows[0];
  }
  async history(id: string, clienteId?: string) {
    await this.get(id, clienteId);
    return this.db.$queryRaw<
      Array<{ status: string; ocorridoEm: Date }>
    >`SELECT "status","ocorridoEm" FROM "HistoricoStatusOS" WHERE "osId"=${id} ORDER BY "ocorridoEm","id"`;
  }
  async saga(id: string) {
    if (!idOk(id)) throw new BadRequestException('Identificador inválido');
    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        status: string;
        version: number;
        deadlineAt: Date | null;
        requiresAttention: boolean;
        lastError: string | null;
      }>
    >`SELECT "id","status","version","deadlineAt","requiresAttention","lastError" FROM "SagaInstance" WHERE "osId"=${id}`;
    if (!rows.length) throw new NotFoundException('Saga não encontrada');
    const operations = await this.db.$queryRaw<
      Array<{ step: string; status: string; updatedAt: Date }>
    >`SELECT "step","status","updatedAt" FROM "SagaOperation" WHERE "sagaId"=${rows[0].id} ORDER BY "createdAt","operationId"`;
    return { ...rows[0], operations };
  }
  async report() {
    type Metric = { mediaEmMinutos: number; totalOSConsideradas: number };
    const period = this.db.$queryRaw<
      Metric[]
    >`SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM ("dataFinalizacao"-"dataInicioExecucao"))/60)),0)::int AS "mediaEmMinutos", COUNT(*)::int AS "totalOSConsideradas" FROM "OrdemDeServico" WHERE "dataInicioExecucao" IS NOT NULL AND "dataFinalizacao">="dataInicioExecucao"`;
    const stage = (start: string, end: string) =>
      this.db.$queryRaw<
        Metric[]
      >`WITH beginnings AS (SELECT "osId", MIN("ocorridoEm") AS started FROM "HistoricoStatusOS" WHERE "status"=${start} GROUP BY "osId"), durations AS (SELECT b."osId", MIN(h."ocorridoEm")-b.started AS elapsed FROM beginnings b JOIN "HistoricoStatusOS" h ON h."osId"=b."osId" AND h."status"=${end} AND h."ocorridoEm">=b.started GROUP BY b."osId",b.started) SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM elapsed)/60)),0)::int AS "mediaEmMinutos",COUNT(*)::int AS "totalOSConsideradas" FROM durations`;
    const [total, diagnostico, execucao, finalizacao] = await Promise.all([
      period,
      stage('EM_DIAGNOSTICO', 'AGUARDANDO_APROVACAO'),
      stage('EM_EXECUCAO', 'FINALIZADA'),
      stage('FINALIZADA', 'ENTREGUE'),
    ]);
    return {
      ...total[0],
      etapas: {
        diagnostico: diagnostico[0],
        execucao: execucao[0],
        finalizacao: finalizacao[0],
      },
    };
  }
}
