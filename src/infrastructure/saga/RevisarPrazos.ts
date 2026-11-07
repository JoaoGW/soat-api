import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** A deadline is a prompt for reconciliation, never proof of cancellation. */
export class ReviewSagaDeadlines {
  constructor(private readonly db: PrismaClient) {}
  async execute(now = new Date(), limit = 50): Promise<number> {
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('Parâmetros inválidos');
    return this.db.$executeRaw`
      WITH expired AS (
        SELECT "id" FROM "SagaInstance"
        WHERE "deadlineAt" <= ${now} AND "status" IN ('ORCAMENTO_PENDENTE','AGUARDANDO_APROVACAO','RESERVA_PENDENTE','COBRANCA_PENDENTE','AGUARDANDO_PAGAMENTO','FILA_PENDENTE')
        ORDER BY "deadlineAt", "id" FOR UPDATE SKIP LOCKED LIMIT ${limit}
      )
      UPDATE "SagaInstance" s SET "status" = 'RECONCILIACAO_NECESSARIA', "requiresAttention" = true, "lastError" = 'DEADLINE_EXPIRED', "version" = s."version" + 1, "updatedAt" = NOW()
      FROM expired WHERE s."id" = expired."id"`;
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
