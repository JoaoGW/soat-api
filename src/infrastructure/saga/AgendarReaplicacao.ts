import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { chargeEventValidator } from '../service-bus/ChargeEventConsumer';
import { paymentEventValidator } from '../service-bus/PaymentEventConsumer';
import { ReceivePaymentEvent } from './ReceberPagamento';
import { ReceiveWorkEnqueuedEvent } from './ReceberEnfileiramento';
import { workEnqueuedEventValidator } from '../service-bus/WorkEnqueuedEventConsumer';
import { ReceiveChargeEvent } from './ReceberCobranca';
import { ReplayPendingChargeEvents } from './ReaplicarCobrancas';

type Cursor = { receivedAt: Date; messageId: string };

@Injectable()
export class SagaReplayWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SagaReplayWorker.name);
  private db?: PrismaClient;
  private replay?: ReplayPendingChargeEvents;
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private cursor?: Cursor;
  private stopping = false;

  onModuleInit(): void {
    if (process.env.ENABLE_SAGA_REPLAY !== 'true') return;
    const connection = process.env.SAGA_DATABASE_URL;
    if (!connection) throw new Error('SAGA_DATABASE_URL não configurada');
    let url: URL;
    try {
      url = new URL(connection);
    } catch {
      throw new Error('SAGA_DATABASE_URL inválida');
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.pathname ||
      url.pathname === '/'
    )
      throw new Error('SAGA_DATABASE_URL inválida');
    const validate = chargeEventValidator(
      resolve(process.cwd(), 'docs/contracts/messages'),
    );
    this.db = new PrismaClient({ datasources: { db: { url: connection } } });
    this.replay = new ReplayPendingChargeEvents(
      this.db,
      new ReceiveChargeEvent(this.db),
      validate,
      new ReceivePaymentEvent(this.db),
      paymentEventValidator(resolve(process.cwd(), 'docs/contracts/messages')),
      new ReceiveWorkEnqueuedEvent(this.db),
      workEnqueuedEventValidator(
        resolve(process.cwd(), 'docs/contracts/messages'),
      ),
    );
    this.active = this.poll();
  }

  private async poll(): Promise<void> {
    if (this.stopping || !this.replay) return;
    let delay = 60000;
    try {
      const result = await this.replay.execute(50, this.cursor);
      this.cursor = result.next ?? undefined;
      if (result.next) delay = 0;
      if (result.errors)
        this.logger.warn(
          `${result.errors} evento(s) pendente(s) exigem revisão`,
        );
    } catch {
      this.cursor = undefined;
      this.logger.error('Falha ao reavaliar eventos da Saga');
    }
    if (!this.stopping)
      this.timer = setTimeout(() => {
        this.active = this.poll();
      }, delay);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      await this.active;
    } catch {
      this.logger.error('Falha ao encerrar reaplicação');
    }
    try {
      await this.db?.$disconnect();
    } catch {
      this.logger.error('Falha ao encerrar conexão da Saga');
    }
  }
}
