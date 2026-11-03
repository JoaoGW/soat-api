import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { WorkloadIdentityCredential } from '@azure/identity';
import { ServiceBusClient, ServiceBusReceiver } from '@azure/service-bus';
import { resolve } from 'node:path';
import {
  ChargeEventConsumer,
  chargeEventValidator,
} from './ChargeEventConsumer';
import {
  PaymentEventConsumer,
  paymentEventValidator,
} from './PaymentEventConsumer';
import {
  WorkEnqueuedEventConsumer,
  workEnqueuedEventValidator,
} from './WorkEnqueuedEventConsumer';
import { ReceiveChargeEvent } from '../saga/ReceberCobranca';
import { ReceivePaymentEvent } from '../saga/ReceberPagamento';
import { ReceiveWorkEnqueuedEvent } from '../saga/ReceberEnfileiramento';
import {
  RepairEventConsumer,
  repairEventValidator,
} from './RepairEventConsumer';
import { ReceiveRepairEvent } from '../saga/ReceberReparo';
import {
  DiagnosisEventConsumer,
  diagnosisEventValidator,
} from './RepairEventConsumer';
import { ReceiveDiagnosisEvent } from '../saga/ReceberDiagnostico';

/** Disabled by default; unsupported events are never acknowledged. */
@Injectable()
export class SagaEventWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SagaEventWorker.name);
  private db?: PrismaClient;
  private bus?: ServiceBusClient;
  private receiver?: ServiceBusReceiver;
  private subscription?: { close(): Promise<void> };

  onModuleInit(): void {
    if (process.env.ENABLE_SAGA_EVENT_CONSUMER !== 'true') return;
    const database = process.env.SAGA_DATABASE_URL;
    const namespace = process.env.SERVICE_BUS_NAMESPACE;
    const topic = process.env.SERVICE_BUS_EVENT_TOPIC;
    const subscription = process.env.SERVICE_BUS_SAGA_SUBSCRIPTION;
    if (
      !database ||
      !namespace ||
      !/^[a-z0-9-]+\.servicebus\.windows\.net$/i.test(namespace) ||
      !topic ||
      !subscription ||
      !process.env.AZURE_TENANT_ID ||
      !process.env.AZURE_CLIENT_ID ||
      !process.env.AZURE_FEDERATED_TOKEN_FILE
    )
      throw new Error('Configuração incompleta do consumidor da Saga');
    let parsed: URL;
    try {
      parsed = new URL(database);
    } catch {
      throw new Error('SAGA_DATABASE_URL inválida');
    }
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      !parsed.pathname ||
      parsed.pathname === '/'
    )
      throw new Error('SAGA_DATABASE_URL inválida');
    const directory = resolve(process.cwd(), 'docs/contracts/messages');
    const chargeValidate = chargeEventValidator(directory);
    const paymentValidate = paymentEventValidator(directory);
    const workValidate = workEnqueuedEventValidator(directory);
    const repairValidate = repairEventValidator(directory);
    const diagnosisValidate = diagnosisEventValidator(directory);
    this.db = new PrismaClient({ datasources: { db: { url: database } } });
    this.bus = new ServiceBusClient(
      namespace,
      new WorkloadIdentityCredential(),
    );
    this.receiver = this.bus.createReceiver(topic, subscription, {
      receiveMode: 'peekLock',
    });
    const receiver = this.receiver;
    const charge = new ChargeEventConsumer(
      new ReceiveChargeEvent(this.db),
      chargeValidate,
    );
    const payment = new PaymentEventConsumer(
      new ReceivePaymentEvent(this.db),
      paymentValidate,
    );
    const work = new WorkEnqueuedEventConsumer(
      new ReceiveWorkEnqueuedEvent(this.db),
      workValidate,
    );
    const repair = new RepairEventConsumer(
      new ReceiveRepairEvent(this.db),
      repairValidate,
    );
    const diagnosis = new DiagnosisEventConsumer(
      new ReceiveDiagnosisEvent(this.db),
      diagnosisValidate,
    );
    this.subscription = receiver.subscribe(
      {
        processMessage: async (message) => {
          const body: unknown = message.body;
          const type =
            body && typeof body === 'object' && 'type' in body
              ? body.type
              : undefined;
          if (
            type === 'billing.charge-created.v1' ||
            type === 'billing.charge-failed.v1'
          )
            return charge.process(message, receiver);
          if (type === 'billing.payment-confirmed.v1')
            return payment.process(message, receiver);
          if (type === 'execution.work-enqueued.v1')
            return work.process(message, receiver);
          if (
            type === 'execution.diagnosis-started.v1' ||
            type === 'execution.diagnosis-completed.v1'
          )
            return diagnosis.process(message, receiver);
          if (
            type === 'execution.work-started.v1' ||
            type === 'execution.work-completed.v1'
          )
            return repair.process(message, receiver);
          this.logger.warn(
            'Evento da Saga ainda não suportado; mensagem não confirmada',
          );
          await receiver.abandonMessage(message);
        },
        processError: async (args) => {
          this.logger.error(
            `Falha no transporte Service Bus: ${args.errorSource}`,
          );
        },
      },
      { autoCompleteMessages: false, maxConcurrentCalls: 1 },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.subscription?.close();
    } catch {
      this.logger.error('Falha ao encerrar assinatura');
    }
    try {
      await this.receiver?.close();
    } catch {
      this.logger.error('Falha ao encerrar receptor');
    }
    try {
      await this.bus?.close();
    } catch {
      this.logger.error('Falha ao encerrar Service Bus');
    }
    try {
      await this.db?.$disconnect();
    } catch {
      this.logger.error('Falha ao encerrar banco da Saga');
    }
  }
}
