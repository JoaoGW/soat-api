/* Integração real de broker e bancos; casos de uso no mesmo processo de teste. */
const assert = require('node:assert/strict');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const path = require('node:path');
const { ServiceBusClient } = require('@azure/service-bus');
const { PrismaClient: OsDb } = require('@prisma/client');
const {
  MessageSigner,
  MessageVerifier,
} = require('../../dist/src/infrastructure/messaging/message-signature');
const {
  OpenOrderWithSaga,
} = require('../../dist/src/infrastructure/saga/AbrirOrdem');
const {
  Phase4Registry,
} = require('../../dist/src/infrastructure/saga/CadastrosFase4');
const {
  DeliverOrder,
} = require('../../dist/src/infrastructure/saga/EntregarOrdem');
const {
  DispatchCommands,
} = require('../../dist/src/infrastructure/saga/PublicarComandos');
const {
  ReceiveDiagnosisEvent,
} = require('../../dist/src/infrastructure/saga/ReceberDiagnostico');
const {
  ReceiveQuoteEvent,
} = require('../../dist/src/infrastructure/saga/ReceberOrcamento');
const {
  ReceiveReservationEvent,
} = require('../../dist/src/infrastructure/saga/ReceberReserva');
const {
  ReceiveChargeEvent,
} = require('../../dist/src/infrastructure/saga/ReceberCobranca');
const {
  ReceivePaymentEvent,
} = require('../../dist/src/infrastructure/saga/ReceberPagamento');
const {
  ReceiveWorkEnqueuedEvent,
} = require('../../dist/src/infrastructure/saga/ReceberEnfileiramento');
const {
  ReceiveRepairEvent,
} = require('../../dist/src/infrastructure/saga/ReceberReparo');
const {
  StartCompensation,
} = require('../../dist/src/infrastructure/saga/IniciarCompensacao');
const {
  RecoverLatePayment,
} = require('../../dist/src/infrastructure/saga/RecuperarPagamentoTardio');
const {
  RecoverCompletedRepair,
} = require('../../dist/src/infrastructure/saga/RecuperarReparoConcluido');
const {
  ReviewSagaDeadlines,
} = require('../../dist/src/infrastructure/saga/RevisarPrazos');
const {
  ReceiveCancellationEvent,
} = require('../../dist/src/infrastructure/saga/ReceberCancelamento');
const {
  ReceiveRefundEvent,
} = require('../../dist/src/infrastructure/saga/ReceberReembolso');
const {
  ReceiveReleaseEvent,
} = require('../../dist/src/infrastructure/saga/ReceberLiberacao');
const {
  ReceiveFailureEvent,
} = require('../../dist/src/infrastructure/saga/ReceberFalha');
const {
  FailureEventConsumer,
  failureEventValidator,
} = require('../../dist/src/infrastructure/service-bus/RepairEventConsumer');
const {
  CancellationEventConsumer,
  cancellationEventValidator,
  RefundEventConsumer,
  refundEventValidator,
  ReleaseEventConsumer,
  releaseEventValidator,
} = require('../../dist/src/infrastructure/service-bus/RepairEventConsumer');
const {
  ChargeEventConsumer,
  chargeEventValidator,
} = require('../../dist/src/infrastructure/service-bus/ChargeEventConsumer');
const {
  PaymentEventConsumer,
  paymentEventValidator,
} = require('../../dist/src/infrastructure/service-bus/PaymentEventConsumer');
const {
  WorkEnqueuedEventConsumer,
  workEnqueuedEventValidator,
} = require('../../dist/src/infrastructure/service-bus/WorkEnqueuedEventConsumer');
const {
  RepairEventConsumer,
  repairEventValidator,
} = require('../../dist/src/infrastructure/service-bus/RepairEventConsumer');
const {
  DiagnosisEventConsumer,
  diagnosisEventValidator,
  QuoteEventConsumer,
  quoteEventValidator,
  ReservationEventConsumer,
  reservationEventValidator,
} = require('../../dist/src/infrastructure/service-bus/RepairEventConsumer');
const billingDir = process.env.BILLING_REPO_DIR;
const execDir = process.env.EXECUTION_REPO_DIR;
const osUrl = process.env.OS_TEST_DATABASE_URL;
const billingUrl = process.env.BILLING_TEST_DATABASE_URL;
const connection = process.env.SERVICE_BUS_TEST_CONNECTION_STRING;
for (const value of [osUrl, billingUrl]) {
  if (!value) throw Error('Bancos de teste obrigatórios');
  const url = new URL(value);
  if (
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw Error('Bancos locais terminados em _test são obrigatórios');
}
if (
  osUrl === billingUrl ||
  !billingDir ||
  !execDir ||
  !path.isAbsolute(billingDir) ||
  !path.isAbsolute(execDir)
)
  throw Error('Diretórios absolutos e bancos separados são obrigatórios');
if (
  !connection ||
  !/^Endpoint=sb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(connection) ||
  !/UseDevelopmentEmulator=true/i.test(connection)
)
  throw Error('Broker emulador local obrigatório');
const b = (file) => require(path.join(billingDir, 'dist', file));
const e = (file) => require(path.join(execDir, 'dist', file));
const { PrismaClient: BillingDb } = require(
  path.join(billingDir, 'node_modules/@prisma/client'),
);
const { CosmosClient } = require(
  path.join(execDir, 'node_modules/@azure/cosmos'),
);
const { CosmosDiagnosisStore } = e('infrastructure/cosmos/diagnostico');
const { CosmosDiagnosisActions } = e(
  'infrastructure/cosmos/diagnostico-operacoes',
);
const { CosmosReservationStore } = e('infrastructure/cosmos/reservas');
const { CosmosStockActions } = e('infrastructure/cosmos/estoque');
const { CosmosEnqueueStore } = e('infrastructure/cosmos/enfileirar');
const { CosmosWorkStore } = e('infrastructure/cosmos/reparo');
const { EnqueueCommandConsumer, createEnqueueValidator } = e(
  'infrastructure/service-bus/enqueue-consumer',
);
const { CosmosOutboxDispatcher } = e('infrastructure/cosmos/outbox');
const { DiagnosisCommandConsumer, createDiagnosisValidator } = e(
  'infrastructure/service-bus/diagnosis-consumer',
);
const { ReserveCommandConsumer, createReserveValidator } = e(
  'infrastructure/service-bus/reserve-consumer',
);
const { CancelCommandConsumer, createCancelValidator } = e(
  'infrastructure/service-bus/cancel-consumer',
);
const { ReleaseCommandConsumer, createReleaseValidator } = e(
  'infrastructure/service-bus/release-consumer',
);
const { GenerateQuoteService } = b('application/gerar-orcamento');
const { PrepareChargeService } = b('application/preparar-cobranca');
const { SubmitChargeService } = b('application/enviar-cobranca');
const { ProcessMercadoPagoWebhook } = b('application/processar-webhook');
const { ChargeCommandConsumer, createChargeCommandValidator } = b(
  'infrastructure/service-bus/charge-consumer',
);
const { QuoteDecisionService } = b('application/decidir-orcamento');
const { OutboxDispatcher } = b('application/publicar-outbox');
const { ServiceBusCommandConsumer, createQuoteCommandValidator } = b(
  'infrastructure/service-bus/command-consumer',
);
const { CompensationEvidenceConsumer, evidenceValidator } = b(
  'infrastructure/service-bus/compensation-evidence',
);
const {
  RefundCommandConsumer,
  RefundCommandProcessor,
  refundCommandValidator,
} = b('infrastructure/service-bus/refund-command');
const { PrepareRefundService, SubmitRefundService, ConfirmRefundService } = b(
  'application/reembolsar-pagamento',
);
const { ReconcileRefundService } = b('application/reconciliar-reembolso');
const { ReconcileChargeFromWebhook } = b('application/reconciliar-cobranca');
const dirOs = path.resolve('docs/contracts/messages');
const dirBilling = path.join(billingDir, 'docs/contracts/messages');
const dirExec = path.join(execDir, 'docs/contracts/messages');
const os = new OsDb({ datasources: { db: { url: osUrl } } });
const billing = new BillingDb({ datasources: { db: { url: billingUrl } } });
const cosmosEndpoint = process.env.COSMOS_TEST_ENDPOINT;
if (
  cosmosEndpoint !== 'http://127.0.0.1:8081' &&
  cosmosEndpoint !== 'http://localhost:8081'
)
  throw Error('COSMOS_TEST_ENDPOINT deve apontar ao emulador local');
const cosmos = new CosmosClient({
  endpoint: cosmosEndpoint,
  key: Buffer.from('local-test-key').toString('base64'),
});
const bus = new ServiceBusClient(connection);
const osQueue = bus.createSender('bdd.execution.commands');
const billQueue = bus.createSender('bdd.billing.commands');
const eventTopic = bus.createSender('bdd.events');
const osReceiver = bus.createReceiver('bdd.events', 'bdd.os', {
  receiveMode: 'peekLock',
});
const execReceiver = bus.createReceiver('bdd.execution.commands', {
  receiveMode: 'peekLock',
});
const billReceiver = bus.createReceiver('bdd.billing.commands', {
  receiveMode: 'peekLock',
});
const evidenceReceiver = bus.createReceiver(
  'bdd.events',
  'bdd.billing.evidence',
  { receiveMode: 'peekLock' },
);
function pair(producer) {
  const keys = generateKeyPairSync('ed25519');
  return {
    producer,
    signer: new MessageSigner(
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    ),
    verifier: new MessageVerifier(
      keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      producer,
    ),
  };
}
const keys = {
  os: pair('soat-os-service'),
  billing: pair('soat-billing-service'),
  exec: pair('soat-execution-service'),
};
function syntheticCpf(tag) {
  let base = String(
    BigInt(`0x${tag.replaceAll('-', '').slice(0, 10)}`) % 1000000000n,
  ).padStart(9, '0');
  if (/^(\d)\1+$/.test(base))
    base = `${base.slice(0, 8)}${base[8] === '9' ? '0' : '9'}`;
  const digit = (value) => {
    const sum = [...value].reduce(
      (total, n, i) => total + Number(n) * (value.length + 1 - i),
      0,
    );
    const result = (sum * 10) % 11;
    return String(result === 10 ? 0 : result);
  };
  const first = digit(base);
  return base + first + digit(base + first);
}
function syntheticPlate(tag) {
  let number = BigInt(`0x${tag.replaceAll('-', '').slice(0, 12)}`);
  let letters = '';
  for (let i = 0; i < 3; i++) {
    letters += String.fromCharCode(65 + Number(number % 26n));
    number /= 26n;
  }
  return letters + String(number % 10000n).padStart(4, '0');
}
async function send(sender, payload, key) {
  await sender.sendMessages({
    messageId: payload.messageId,
    subject: payload.type,
    contentType: 'application/json',
    body: payload,
    applicationProperties: { signature: key.signer.sign(payload) },
  });
}
async function receive(receiver, expected, key, consumer) {
  const messages = await receiver.receiveMessages(1, {
    maxWaitTimeInMs: 15000,
  });
  assert.equal(messages.length, 1, `broker não entregou ${expected}`);
  const msg = messages[0];
  assert.equal(msg.subject, expected);
  assert.ok(
    key.verifier.verify(msg.body, msg.applicationProperties?.signature),
  );
  await consumer.process(msg, receiver);
  return msg.body;
}
async function expectSent(dispatch) {
  const deadline = Date.now() + 10000;
  do {
    const result = await dispatch();
    if (result !== 'EMPTY') {
      assert.equal(result, 'SENT');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw Error('Outbox permaneceu vazia até o prazo de teste');
}
async function scenario(mode) {
  const tag = randomUUID();
  const database = (
    await cosmos.databases.createIfNotExists({
      id: `bdd_${tag.replaceAll('-', '')}`,
    })
  ).database;
  const container = (
    await database.containers.createIfNotExists({
      id: 'operations',
      partitionKey: { paths: ['/filialId'] },
    })
  ).container;
  try {
    const osDispatch = new DispatchCommands(os, {
      publish: async ({ type, payload }) =>
        send(
          type.startsWith('billing.') ? billQueue : osQueue,
          payload,
          keys.os,
        ),
    });
    const billingDispatch = new OutboxDispatcher(billing, {
      publish: async ({ payload }) => send(eventTopic, payload, keys.billing),
    });
    const executionDispatch = new CosmosOutboxDispatcher(container, {
      publish: async ({ payload }) => send(eventTopic, payload, keys.exec),
    });
    const execDiag = new DiagnosisCommandConsumer(
      new CosmosDiagnosisStore(container),
      createDiagnosisValidator(dirExec),
    );
    const execReserve = new ReserveCommandConsumer(
      new CosmosReservationStore(container),
      createReserveValidator(dirExec),
    );
    const osDiag = new DiagnosisEventConsumer(
      new ReceiveDiagnosisEvent(os),
      diagnosisEventValidator(dirOs),
    );
    const osQuote = new QuoteEventConsumer(
      new ReceiveQuoteEvent(os),
      quoteEventValidator(dirOs),
    );
    const osReserve = new ReservationEventConsumer(
      new ReceiveReservationEvent(os, 'pos-test'),
      reservationEventValidator(dirOs),
    );
    const billQuote = new ServiceBusCommandConsumer(
      new GenerateQuoteService(billing),
      createQuoteCommandValidator(dirBilling),
    );
    const providerOrder = `ORD${tag.replaceAll('-', '').slice(0, 26)}`;
    const providerPayment = String(
      BigInt(`0x${tag.replaceAll('-', '').slice(0, 12)}`),
    );
    let providerCharge;
    let createCalls = 0;
    let refunded = false;
    let refundCalls = 0;
    const providerRefund = `REF${tag.replaceAll('-', '').slice(0, 26)}`;
    const paymentProvider = {
      create: async (input) => {
        createCalls++;
        providerCharge = input.externalReference;
        if (mode === 'charge-timeout')
          throw new Error('timeout após criação no provedor simulado');
        return {
          id: providerOrder,
          type: 'qr',
          external_reference: providerCharge,
          currency: 'BRL',
          total_amount: (input.amountInCents / 100).toFixed(2),
          status: 'created',
          type_response: { qr_data: 'QR-TEST' },
        };
      },
      get: async () => ({
        id: providerOrder,
        type: 'qr',
        external_reference: providerCharge,
        currency: 'BRL',
        total_amount: '10.00',
        status: refunded ? 'refunded' : 'processed',
        status_detail: 'accredited',
        transactions: {
          payments: [
            {
              id: `txn-${tag}`,
              reference_id: providerPayment,
              status: refunded ? 'refunded' : 'processed',
              status_detail: 'accredited',
              paid_amount: '10.00',
              ...(refunded ? { refunded_amount: '10.00' } : {}),
            },
          ],
          ...(refunded
            ? {
                refunds: [
                  {
                    id: providerRefund,
                    transaction_id: `txn-${tag}`,
                    status: 'processed',
                    amount: '10.00',
                  },
                ],
              }
            : {}),
        },
      }),
      refund: async () => {
        refundCalls++;
        refunded = true;
        if (mode === 'refund-timeout')
          throw new Error('timeout após reembolso no provedor simulado');
        return {
          id: providerOrder,
          transactions: {
            refunds: [{ id: providerRefund, transaction_id: `txn-${tag}` }],
          },
        };
      },
      getPayment: async () => ({
        id: Number(providerPayment),
        status: 'approved',
        status_detail: 'accredited',
        currency_id: 'BRL',
        transaction_amount: 10,
        transaction_amount_refunded: 0,
        date_approved: new Date().toISOString(),
      }),
    };
    const billCharge = new ChargeCommandConsumer(
      new PrepareChargeService(billing),
      new SubmitChargeService(billing, paymentProvider),
      createChargeCommandValidator(dirBilling),
    );
    const osCharge = new ChargeEventConsumer(
      new ReceiveChargeEvent(os),
      chargeEventValidator(dirOs),
    );
    const osPayment = new PaymentEventConsumer(
      new ReceivePaymentEvent(os),
      paymentEventValidator(dirOs),
    );
    const execEnqueue = new EnqueueCommandConsumer(
      new CosmosEnqueueStore(container),
      createEnqueueValidator(dirExec),
    );
    const osEnqueued = new WorkEnqueuedEventConsumer(
      new ReceiveWorkEnqueuedEvent(os),
      workEnqueuedEventValidator(dirOs),
    );
    const osRepair = new RepairEventConsumer(
      new ReceiveRepairEvent(os),
      repairEventValidator(dirOs),
    );
    const registry = new Phase4Registry(os);
    const client = (
      await registry.createClient({
        nome: 'Teste',
        documento: syntheticCpf(tag),
        contato: 'test@example.test',
      })
    ).id;
    const vehicle = (
      await registry.createVehicle({
        clienteId: client,
        placa: syntheticPlate(tag),
        marca: 'X',
        modelo: 'Y',
        ano: 2020,
      })
    ).id;
    const opened = await new OpenOrderWithSaga(os).execute({
      actorId: 'admin',
      key: `key-${tag}`,
      clienteId: client,
      veiculoId: vehicle,
      filialId: 'branch',
    });
    await expectSent(() => osDispatch.execute());
    await receive(
      execReceiver,
      'execution.request-diagnosis.v1',
      keys.os,
      execDiag,
    );
    const diagnosis = new CosmosDiagnosisActions(container);
    await diagnosis.putCatalog('branch', {
      sourceId: 'p1',
      itemType: 'PART',
      name: 'Peca',
      unitPriceInCents: 500,
      active: true,
    });
    await new CosmosStockActions(container).set({
      filialId: 'branch',
      sku: 'p1',
      balance: mode === 'no-stock' ? 1 : 5,
      operationId: `stock-${tag}`,
      actorId: 'test-admin',
      reason: 'BDD_SETUP',
    });
    const action = {
      osId: opened.id,
      sagaId: opened.sagaId,
      filialId: 'branch',
      correlationId: opened.sagaId,
    };
    await diagnosis.apply('start', { ...action, operationId: `start-${tag}` });
    await expectSent(() => executionDispatch.dispatchOne());
    await receive(
      osReceiver,
      'execution.diagnosis-started.v1',
      keys.exec,
      osDiag,
    );
    await diagnosis.apply('complete', {
      ...action,
      operationId: `complete-${tag}`,
      items: [{ sourceId: 'p1', itemType: 'PART', quantity: 2 }],
    });
    await expectSent(() => executionDispatch.dispatchOne());
    await receive(
      osReceiver,
      'execution.diagnosis-completed.v1',
      keys.exec,
      osDiag,
    );
    await expectSent(() => osDispatch.execute());
    await receive(
      billReceiver,
      'billing.generate-quote.v1',
      keys.os,
      billQuote,
    );
    const quote = await billing.quote.findFirstOrThrow({
      where: { osId: opened.id },
    });
    assert.equal(quote.totalInCents, 1000);
    await expectSent(() => billingDispatch.dispatchOne());
    await receive(osReceiver, 'billing.quote-issued.v1', keys.billing, osQuote);
    await new QuoteDecisionService(billing).execute({
      quoteId: quote.id,
      clientId: client,
      version: 1,
      decision: 'APPROVED',
      idempotencyKey: `approve-${tag}`,
      correlationId: opened.sagaId,
    });
    await expectSent(() => billingDispatch.dispatchOne());
    await receive(
      osReceiver,
      'billing.quote-approved.v1',
      keys.billing,
      osQuote,
    );
    await expectSent(() => osDispatch.execute());
    await receive(
      execReceiver,
      'execution.reserve-parts.v1',
      keys.os,
      execReserve,
    );
    if (mode === 'no-stock') {
      await expectSent(() => executionDispatch.dispatchOne());
      await receive(
        osReceiver,
        'execution.parts-reservation-failed.v1',
        keys.exec,
        new FailureEventConsumer(
          new ReceiveFailureEvent(os),
          failureEventValidator(dirOs),
        ),
      );
      await expectSent(() => osDispatch.execute());
      await receive(
        execReceiver,
        'execution.cancel-work.v1',
        keys.os,
        new CancelCommandConsumer(
          new CosmosWorkStore(container),
          createCancelValidator(dirExec),
        ),
      );
      await expectSent(() => executionDispatch.dispatchOne());
      await receive(
        osReceiver,
        'execution.work-cancelled.v1',
        keys.exec,
        new CancellationEventConsumer(
          new ReceiveCancellationEvent(os),
          cancellationEventValidator(dirOs),
        ),
      );
      const failed =
        await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
      assert.equal(failed[0].status, 'COMPENSADA');
      const remaining = (await container.item('stock:p1', 'branch').read())
        .resource;
      assert.equal(remaining.balance, 1);
      assert.equal(remaining.reserved, 0);
      assert.equal(
        await billing.charge.count({ where: { osId: opened.id } }),
        0,
      );
      process.stdout.write(
        'Estoque insuficiente: falha, cancelamento e ausência de cobrança confirmados pelo broker.\n',
      );
      return;
    }
    await expectSent(() => executionDispatch.dispatchOne());
    await receive(
      osReceiver,
      'execution.parts-reserved.v1',
      keys.exec,
      osReserve,
    );
    let saga =
      await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
    assert.equal(saga[0].status, 'COBRANCA_PENDENTE');
    const stock = (await container.item('stock:p1', 'branch').read()).resource;
    assert.equal(stock.reserved, 2);
    await expectSent(() => osDispatch.execute());
    await receive(
      billReceiver,
      'billing.create-charge.v1',
      keys.os,
      billCharge,
    );
    const hookId = `hook-${tag}`;
    await billing.receivedWebhook.create({
      data: {
        provider: 'mercado-pago-orders',
        eventId: hookId,
        status: 'RECEIVED',
        payload: {
          type: 'order',
          action: 'order.processed',
          data: { id: providerOrder },
        },
      },
    });
    if (mode === 'charge-timeout') {
      assert.equal(
        await new ReconcileChargeFromWebhook(billing, paymentProvider).execute(
          hookId,
        ),
        'RECOVERED',
      );
      await receive(
        billReceiver,
        'billing.create-charge.v1',
        keys.os,
        billCharge,
      );
      assert.equal(createCalls, 1);
    }
    await expectSent(() => billingDispatch.dispatchOne());
    await receive(
      osReceiver,
      'billing.charge-created.v1',
      keys.billing,
      osCharge,
    );
    if (mode === 'late-payment') {
      await os.$executeRaw`UPDATE "SagaInstance" SET "deadlineAt"=${new Date('1990-01-01T00:00:00Z')} WHERE "id"=${opened.sagaId}`;
      await new ReviewSagaDeadlines(os).execute();
    }
    assert.equal(
      await new ProcessMercadoPagoWebhook(billing, paymentProvider).execute(
        hookId,
      ),
      'APPLIED',
    );
    await expectSent(() => billingDispatch.dispatchOne());
    await receive(
      osReceiver,
      'billing.payment-confirmed.v1',
      keys.billing,
      osPayment,
    );
    if (mode !== 'late-payment') {
      await expectSent(() => osDispatch.execute());
      await receive(
        execReceiver,
        'execution.enqueue-work.v1',
        keys.os,
        execEnqueue,
      );
      await expectSent(() => executionDispatch.dispatchOne());
      await receive(
        osReceiver,
        'execution.work-enqueued.v1',
        keys.exec,
        osEnqueued,
      );
    }
    if (
      mode === 'compensate' ||
      mode === 'refund-timeout' ||
      mode === 'late-payment'
    ) {
      if (mode === 'late-payment')
        assert.equal(
          await new RecoverLatePayment(os).execute({
            sagaId: opened.sagaId,
            actorId: 'test-admin',
            reason: 'LATE_PAYMENT',
          }),
          'STARTED',
        );
      else
        assert.equal(
          await new StartCompensation(os).execute(
            opened.sagaId,
            'TEST_FAILURE',
          ),
          'STARTED',
        );
      const work = new CosmosWorkStore(container);
      await expectSent(() => osDispatch.execute());
      await receive(
        execReceiver,
        'execution.cancel-work.v1',
        keys.os,
        new CancelCommandConsumer(work, createCancelValidator(dirExec)),
      );
      await expectSent(() => executionDispatch.dispatchOne());
      await receive(
        osReceiver,
        'execution.work-cancelled.v1',
        keys.exec,
        new CancellationEventConsumer(
          new ReceiveCancellationEvent(os),
          cancellationEventValidator(dirOs),
        ),
      );
      // A assinatura dedicada recebe todos os eventos; apenas o cancelamento é evidência para Billing.
      const evidence = new CompensationEvidenceConsumer(
        billing,
        keys.exec.verifier,
        evidenceValidator(dirBilling),
      );
      for (;;) {
        const messages = await evidenceReceiver.receiveMessages(1, {
          maxWaitTimeInMs: 15000,
        });
        assert.equal(messages.length, 1, 'evidência de cancelamento ausente');
        const message = messages[0];
        if (
          message.subject === 'execution.work-cancelled.v1' &&
          message.body.sagaId === opened.sagaId
        ) {
          await evidence.process(message, evidenceReceiver);
          break;
        }
        await evidenceReceiver.completeMessage(message);
      }
      await expectSent(() => osDispatch.execute());
      await receive(
        billReceiver,
        'billing.refund-payment.v1',
        keys.os,
        new RefundCommandConsumer(billing, refundCommandValidator(dirBilling)),
      );
      const processor = new RefundCommandProcessor(
        billing,
        new PrepareRefundService(billing),
        new SubmitRefundService(billing, paymentProvider),
        new ConfirmRefundService(billing, paymentProvider),
        refundCommandValidator(dirBilling),
      );
      if (mode === 'refund-timeout') {
        assert.equal(await processor.processOne(), 'RECONCILIACAO_NECESSARIA');
        const record = await billing.refund.findFirstOrThrow({
          where: { payment: { charge: { osId: opened.id } } },
        });
        assert.equal(
          await new ReconcileRefundService(billing, paymentProvider).execute(
            record.operationId,
          ),
          'REFUNDED',
        );
      } else assert.equal(await processor.processOne(), 'REFUNDED');
      assert.equal(refundCalls, 1);
      const refundConsumer = new RefundEventConsumer(
        new ReceiveRefundEvent(os),
        refundEventValidator(dirOs),
      );
      await expectSent(() => billingDispatch.dispatchOne());
      const refundEvent = await receive(
        osReceiver,
        'billing.payment-refunded.v1',
        keys.billing,
        refundConsumer,
      );
      await send(eventTopic, refundEvent, keys.billing);
      await receive(
        osReceiver,
        'billing.payment-refunded.v1',
        keys.billing,
        refundConsumer,
      );
      const releaseCommands =
        await os.$queryRaw`SELECT count(*)::int AS "total" FROM "SagaOperation" WHERE "sagaId"=${opened.sagaId} AND "commandType"='execution.release-parts.v1'`;
      assert.equal(releaseCommands[0].total, 1);
      await expectSent(() => osDispatch.execute());
      await receive(
        execReceiver,
        'execution.release-parts.v1',
        keys.os,
        new ReleaseCommandConsumer(work, createReleaseValidator(dirExec)),
      );
      await expectSent(() => executionDispatch.dispatchOne());
      await receive(
        osReceiver,
        'execution.parts-released.v1',
        keys.exec,
        new ReleaseEventConsumer(
          new ReceiveReleaseEvent(os),
          releaseEventValidator(dirOs),
        ),
      );
      saga =
        await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
      assert.equal(saga[0].status, 'COMPENSADA');
      const restored = (await container.item('stock:p1', 'branch').read())
        .resource;
      assert.equal(restored.balance, 5);
      assert.equal(restored.reserved, 0);
      assert.equal(await processor.processOne(), 'EMPTY');
      assert.equal(refundCalls, 1);
      process.stdout.write(
        mode === 'late-payment'
          ? 'Pagamento tardio: execução cercada, reembolso simulado e liberação confirmados pelo broker.\n'
          : mode === 'refund-timeout'
            ? 'Timeout de reembolso: consulta canônica simulada confirmou reembolso e liberação sem novo pedido.\n'
            : 'Falha após pagamento: cancelamento, reembolso simulado e liberação de estoque confirmados pelo broker.\n',
      );
      return;
    }
    const task = (await container.item(`task:${opened.id}`, 'branch').read())
      .resource;
    const work = new CosmosWorkStore(container);
    await work.start({
      ...action,
      executionId: task.executionId,
      messageId: `work-start-${tag}`,
      operationId: `work-start-${tag}`,
    });
    await expectSent(() => executionDispatch.dispatchOne());
    await receive(osReceiver, 'execution.work-started.v1', keys.exec, osRepair);
    if (mode === 'started' || mode === 'started-completed') {
      const before = (await container.item('stock:p1', 'branch').read())
        .resource;
      assert.equal(
        await new StartCompensation(os).execute(opened.sagaId, 'TEST_FAILURE'),
        'RECONCILIACAO_NECESSARIA',
      );
      const blocked =
        await os.$queryRaw`SELECT "status", "requiresAttention" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
      assert.equal(blocked[0].status, 'RECONCILIACAO_NECESSARIA');
      assert.equal(blocked[0].requiresAttention, true);
      const held = (await container.item('stock:p1', 'branch').read()).resource;
      assert.equal(held.balance, before.balance);
      assert.equal(held.reserved, before.reserved);
      assert.equal(refundCalls, 0);
      assert.equal(
        await billing.refund.count({
          where: { payment: { charge: { osId: opened.id } } },
        }),
        0,
      );
      if (mode === 'started-completed') {
        const recover = new RecoverCompletedRepair(os);
        const input = {
          sagaId: opened.sagaId,
          actorId: 'test-admin',
          reason: 'REPAIR_CONFIRMED',
        };
        await assert.rejects(() => recover.execute(input));
        await work.complete({
          ...action,
          executionId: task.executionId,
          messageId: `work-end-${tag}`,
          operationId: `work-end-${tag}`,
        });
        await expectSent(() => executionDispatch.dispatchOne());
        await receive(
          osReceiver,
          'execution.work-completed.v1',
          keys.exec,
          osRepair,
        );
        const conflict = `conflict-${tag}`;
        await os.$executeRaw`INSERT INTO "SagaOperation" ("operationId","sagaId","step","businessAttempt","commandType","status","updatedAt") VALUES (${conflict},${opened.sagaId},'TEST_CANCEL',1,'execution.cancel-work.v1','PENDING',NOW())`;
        await assert.rejects(() => recover.execute(input));
        await os.$executeRaw`DELETE FROM "SagaOperation" WHERE "operationId"=${conflict}`;
        assert.equal(await recover.execute(input), 'CONCLUIDA');
        assert.equal(await new DeliverOrder(os).execute(opened.id), 'ENTREGUE');
        assert.equal(refundCalls, 0);
        process.stdout.write(
          'Reparo concluído após reconciliação: evidências verificadas e entrega autorizada sem reembolso.\n',
        );
        return;
      }
      process.stdout.write(
        'Falha após início do reparo: reconciliação exigida, sem reembolso ou liberação automáticos.\n',
      );
      return;
    }
    await work.complete({
      ...action,
      executionId: task.executionId,
      messageId: `work-end-${tag}`,
      operationId: `work-end-${tag}`,
    });
    await expectSent(() => executionDispatch.dispatchOne());
    await receive(
      osReceiver,
      'execution.work-completed.v1',
      keys.exec,
      osRepair,
    );
    saga =
      await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
    assert.equal(saga[0].status, 'CONCLUIDA');
    const done = (await container.item('stock:p1', 'branch').read()).resource;
    assert.equal(done.balance, 3);
    assert.equal(done.reserved, 0);
    assert.equal(await new DeliverOrder(os).execute(opened.id), 'ENTREGUE');
    assert.equal(await new DeliverOrder(os).execute(opened.id), 'JA_ENTREGUE');
    const delivered =
      await os.$queryRaw`SELECT "status" FROM "OrdemDeServico" WHERE "id"=${opened.id}`;
    assert.equal(delivered[0].status, 'ENTREGUE');
    if (mode === 'charge-timeout') assert.equal(createCalls, 1);
    process.stdout.write(
      mode === 'charge-timeout'
        ? 'Timeout de cobrança: order simulada recuperada sem nova criação; reparo e entrega concluídos pelo broker.\n'
        : 'Jornada pelo broker e bancos emulados: OS, diagnóstico, orçamento, pagamento simulado, reparo e entrega concluídos.\n',
    );
  } finally {
    await database.delete();
  }
}
async function main() {
  const scenarios = [
    'happy',
    'charge-timeout',
    'compensate',
    'refund-timeout',
    'late-payment',
    'no-stock',
    'started',
    'started-completed',
  ];
  const args = process.argv.slice(2);
  if (
    args.length &&
    (args.length !== 2 ||
      args[0] !== '--scenario' ||
      !scenarios.includes(args[1]))
  )
    throw Error('Cenário BDD desconhecido');
  const selected = args[1];
  for (const mode of selected ? [selected] : scenarios) await scenario(mode);
}
main()
  .finally(async () => {
    await Promise.allSettled([
      osReceiver.close(),
      execReceiver.close(),
      billReceiver.close(),
      evidenceReceiver.close(),
      osQueue.close(),
      billQueue.close(),
      eventTopic.close(),
    ]);
    await bus.close();
    await os.$disconnect();
    await billing.$disconnect();
    cosmos.dispose();
  })
  .catch((e) => {
    process.stderr.write(`${e.stack || e}\n`);
    process.exitCode = 1;
  });
