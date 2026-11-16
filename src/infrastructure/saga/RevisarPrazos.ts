import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { StartCompensation } from './IniciarCompensacao';

/**
 * Política de prazos vencidos por estado da Saga:
 * - DIAGNOSTICO_PENDENTE, AGUARDANDO_APROVACAO e NA_FILA: nenhum trabalho físico
 *   começou e não há comando da OS cujo efeito dependa do prazo, então a
 *   compensação começa automaticamente com cancel-work (motivo
 *   DEADLINE_EXPIRED). Execution é a autoridade e responde CANCELLED ou
 *   ALREADY_STARTED; o segundo caso segue para reconciliação no receptor.
 * - EM_EXECUCAO: o trabalho físico começou e não há rollback automático; a Saga
 *   vai para reconciliação com EXECUTION_DEADLINE_EXPIRED.
 * - ORCAMENTO_PENDENTE, RESERVA_PENDENTE, COBRANCA_PENDENTE,
 *   AGUARDANDO_PAGAMENTO e FILA_PENDENTE: há comando em voo (orçamento,
 *   reserva, cobrança ou fila) que o outro serviço ainda pode aplicar, e o
 *   prazo vencido não prova que não aplicou. A Saga vai para reconciliação com
 *   DEADLINE_EXPIRED até chegar um fato autenticado (ver ReceberFalha).
 */
export class ReviewSagaDeadlines {
  constructor(
    private readonly db: PrismaClient,
    private readonly compensation = new StartCompensation(db),
  ) {}
  async execute(now = new Date(), limit = 50): Promise<number> {
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('Parâmetros inválidos');
    const reconciled = await this.db.$executeRaw`
      WITH expired AS (
        SELECT "id" FROM "SagaInstance"
        WHERE "deadlineAt" <= ${now} AND "status" IN ('ORCAMENTO_PENDENTE','RESERVA_PENDENTE','COBRANCA_PENDENTE','AGUARDANDO_PAGAMENTO','FILA_PENDENTE','EM_EXECUCAO')
        ORDER BY "deadlineAt", "id" FOR UPDATE SKIP LOCKED LIMIT ${limit}
      )
      UPDATE "SagaInstance" s SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "lastError" = CASE WHEN s."status" = 'EM_EXECUCAO' THEN 'EXECUTION_DEADLINE_EXPIRED' ELSE 'DEADLINE_EXPIRED' END, "version" = s."version" + 1, "updatedAt" = NOW()
      FROM expired WHERE s."id" = expired."id"`;
    // Lista sem bloqueio; cada Saga é rebloqueada (SKIP LOCKED) e reavaliada
    // em uma transação própria junto com o comando de cancelamento.
    const candidates = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "SagaInstance"
      WHERE "deadlineAt" <= ${now} AND "status" IN ('DIAGNOSTICO_PENDENTE','AGUARDANDO_APROVACAO','NA_FILA')
      ORDER BY "deadlineAt", "id" LIMIT ${limit}`;
    let compensated = 0;
    let failed = 0;
    for (const { id } of candidates) {
      try {
        if ((await this.compensation.startExpired(id, now)) === 'STARTED')
          compensated++;
      } catch {
        failed++;
      }
    }
    // Uma Saga com erro não impede as demais; o ciclo seguinte tenta de novo.
    if (failed)
      throw new Error(`${failed} compensação(ões) por prazo não iniciada(s)`);
    return reconciled + compensated;
  }
}
@Injectable()
export class SagaDeadlineWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SagaDeadlineWorker.name);
  private db?: PrismaClient;
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopping = false;
  onModuleInit(): void {
    if (process.env.ENABLE_SAGA_DEADLINE_REVIEW !== 'true') return;
    const url = process.env.SAGA_DATABASE_URL;
    if (!url) throw new Error('SAGA_DATABASE_URL não configurada');
    this.db = new PrismaClient({ datasources: { db: { url } } });
    this.active = this.poll();
  }
  private async poll(): Promise<void> {
    if (this.stopping || !this.db) return;
    try {
      await new ReviewSagaDeadlines(this.db).execute();
    } catch {
      this.logger.error('Falha ao revisar prazos da Saga');
    }
    if (!this.stopping)
      this.timer = setTimeout(() => {
        this.active = this.poll();
      }, 60000);
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      await this.active;
    } catch {
      this.logger.error('Falha ao encerrar revisão');
    }
    await this.db?.$disconnect();
  }
}
