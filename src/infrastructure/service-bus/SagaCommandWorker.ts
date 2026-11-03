import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { WorkloadIdentityCredential } from '@azure/identity';
import { ServiceBusClient, ServiceBusSender } from '@azure/service-bus';
import { DispatchCommands } from '../saga/PublicarComandos';
import { MessageSigner } from '../messaging/message-signature';

@Injectable()
export class SagaCommandWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SagaCommandWorker.name);
  private db?: PrismaClient;
  private bus?: ServiceBusClient;
  private billing?: ServiceBusSender;
  private execution?: ServiceBusSender;
  private dispatcher?: DispatchCommands;
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopping = false;
  onModuleInit(): void {
    if (process.env.ENABLE_SAGA_COMMAND_PUBLISHER !== 'true') return;
    const db = process.env.SAGA_DATABASE_URL;
    const privateKey = process.env.OS_MESSAGE_PRIVATE_KEY;
    const ns = process.env.SERVICE_BUS_NAMESPACE;
    const b = process.env.SERVICE_BUS_BILLING_QUEUE;
    const e = process.env.SERVICE_BUS_EXECUTION_QUEUE;
    if (
      !db ||
      !privateKey ||
      !ns ||
      !/^[a-z0-9-]+\.servicebus\.windows\.net$/i.test(ns) ||
      !b ||
      !e ||
      b === e ||
      !process.env.AZURE_TENANT_ID ||
      !process.env.AZURE_CLIENT_ID ||
      !process.env.AZURE_FEDERATED_TOKEN_FILE
    )
      throw new Error('Configuração incompleta do publicador da Saga');
    const signer = new MessageSigner(privateKey);
    this.db = new PrismaClient({ datasources: { db: { url: db } } });
    this.bus = new ServiceBusClient(ns, new WorkloadIdentityCredential());
    this.billing = this.bus.createSender(b);
    this.execution = this.bus.createSender(e);
    const billing = this.billing;
    const execution = this.execution;
    this.dispatcher = new DispatchCommands(this.db, {
      publish: async ({ messageId, type, payload }) => {
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('messageId' in payload) ||
          payload.messageId !== messageId ||
          !('type' in payload) ||
          payload.type !== type ||
          !('producer' in payload) ||
          payload.producer !== 'soat-os-service'
        )
          throw new Error('Envelope inválido');
        const sender = [
          'billing.generate-quote.v1',
          'billing.create-charge.v1',
        ].includes(type)
          ? billing
          : [
                'execution.request-diagnosis.v1',
                'execution.reserve-parts.v1',
                'execution.enqueue-work.v1',
                'execution.cancel-work.v1',
                'execution.release-parts.v1',
              ].includes(type)
            ? execution
            : null;
        if (!sender) throw new Error('Destino de comando desconhecido');
        await sender.sendMessages({
          messageId,
          subject: type,
          contentType: 'application/json',
          body: payload,
          applicationProperties: { signature: signer.sign(payload) },
        });
      },
    });
    this.active = this.poll();
  }
  private async poll(): Promise<void> {
    if (this.stopping || !this.dispatcher) return;
    try {
      await this.dispatcher.execute();
    } catch {
      this.logger.error('Falha ao publicar comando da Saga');
    }
    if (!this.stopping)
      this.timer = setTimeout(() => {
        this.active = this.poll();
      }, 1000);
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    for (const action of [
      () => this.active,
      () => this.billing?.close(),
      () => this.execution?.close(),
      () => this.bus?.close(),
      () => this.db?.$disconnect(),
    ]) {
      try {
        await action();
      } catch {
        this.logger.error('Falha ao encerrar publicador da Saga');
      }
    }
  }
}
