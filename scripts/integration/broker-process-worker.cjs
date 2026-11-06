/* Adaptador de teste local: cada processo hospeda somente um serviço. */
const path = require('node:path');
const root = process.cwd();
const { ServiceBusClient } = require('@azure/service-bus');
const {
  MessageSigner,
  MessageVerifier,
} = require('../../dist/src/infrastructure/messaging/message-signature');
let close = async () => {};
let actions = {};
process.on('message', async (request) => {
  try {
    if (request.method === 'init') {
      await init(request.config);
      process.send({ id: request.id, ok: true, pid: process.pid });
      return;
    }
    if (request.method === 'stop') {
      await close();
      await global.soatTestTraceSdk?.shutdown();
      process.send({ id: request.id, ok: true });
      process.disconnect();
      return;
    }
    if (!actions[request.method]) throw Error('Ação desconhecida');
    const result = await actions[request.method](request.data);
    process.send({ id: request.id, ok: true, result });
  } catch (error) {
    process.send({
      id: request.id,
      ok: false,
      error: error.stack || String(error),
    });
  }
});
async function init(c) {
  if (
    !c ||
    !['os', 'billing', 'execution'].includes(c.role) ||
    !/^Endpoint=sb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(c.connection) ||
    !/UseDevelopmentEmulator=true/i.test(c.connection) ||
    !['http://localhost:8081', 'http://127.0.0.1:8081'].includes(
      c.cosmosEndpoint,
    )
  )
    throw Error('Somente emuladores locais são permitidos');
  if (c.role !== 'execution') {
    const url = new URL(c.role === 'os' ? c.osUrl : c.billingUrl);
    if (
      !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    )
      throw Error('Banco local de teste obrigatório');
  }
  const r = (base, name) => require(path.join(base, 'dist', name));
  const os = (name) => r(root, `src/${name}`);
  const b = (name) => r(c.billingDir, name);
  const e = (name) => r(c.execDir, name);
  const bus = new ServiceBusClient(c.connection);
  const signing = new MessageSigner(c.keys[c.role].privateKey);
  const verifiers = Object.fromEntries(
    Object.entries(c.keys).map(([role, key]) => [
      key.producer,
      new MessageVerifier(key.publicKey, key.producer),
    ]),
  );
  const osQueue = bus.createSender('bdd.execution.commands');
  const billingQueue = bus.createSender('bdd.billing.commands');
  const topic = bus.createSender('bdd.events');
  const send = async (sender, payload) =>
    sender.sendMessages({
      messageId: payload.messageId,
      subject: payload.type,
      contentType: 'application/json',
      body: payload,
      applicationProperties: { signature: signing.sign(payload) },
    });
  const timerRefs = [];
  const receivers = [];
  const subscriptions = [];
  let db, cosmos, executionContainer;
  let allowRefund = !c.badEvidence;
  actions.resumeRefund = async () => { allowRefund = true; };
  function poll(fn) {
    if (c.productionWorkers) return;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await fn();
      } catch (err) {
        console.error(c.role, 'poll', err);
      } finally {
        busy = false;
      }
    }, 100);
    timerRefs.push(timer);
  }
  function subscribe(receiver, route) {
    receivers.push(receiver);
    if (c.productionWorkers) return;
    subscriptions.push(
      receiver.subscribe(
        {
          processMessage: async (m) => {
            const verifier = verifiers[m.body?.producer];
            if (!verifier?.verify(m.body, m.applicationProperties?.signature)) {
              await receiver.deadLetterMessage(m, {
                deadLetterReason: 'UnauthenticatedProducer',
              });
              return;
            }
            const consumer = route[m.subject];
            if (!consumer) {
              await receiver.deadLetterMessage(m, {
                deadLetterReason: 'UnsupportedContract',
              });
              return;
            }
            await consumer.process(m, receiver);
          },
          processError: async (err) =>
            console.error(c.role, err.errorSource, err.error?.message),
        },
        { autoCompleteMessages: false, maxConcurrentCalls: 1 },
      ),
    );
  }
  let provider;
  if (c.role === 'os') {
    const { PrismaClient } = require('@prisma/client');
    db = new PrismaClient({ datasources: { db: { url: c.osUrl } } });
    const { DispatchCommands } = os('infrastructure/saga/PublicarComandos');
    const dispatch = new DispatchCommands(db, {
      publish: async ({ type, payload }) =>
        send(type.startsWith('billing.') ? billingQueue : osQueue, payload),
    });
    poll(() => dispatch.execute());
    const rep = os('infrastructure/service-bus/RepairEventConsumer');
    const dir = path.join(root, 'docs/contracts/messages');
    const diagnostic = new rep.DiagnosisEventConsumer(
      new (os('infrastructure/saga/ReceberDiagnostico').ReceiveDiagnosisEvent)(
        db,
      ),
      rep.diagnosisEventValidator(dir),
    );
    const quote = new rep.QuoteEventConsumer(
      new (os('infrastructure/saga/ReceberOrcamento').ReceiveQuoteEvent)(db),
      rep.quoteEventValidator(dir),
    );
    const reserve = new rep.ReservationEventConsumer(
      new (os('infrastructure/saga/ReceberReserva').ReceiveReservationEvent)(
        db,
        'pos-test',
      ),
      rep.reservationEventValidator(dir),
    );
    const repair = new rep.RepairEventConsumer(
      new (os('infrastructure/saga/ReceberReparo').ReceiveRepairEvent)(db),
      rep.repairEventValidator(dir),
    );
    const chargeModule = os('infrastructure/service-bus/ChargeEventConsumer');
    const paymentModule = os('infrastructure/service-bus/PaymentEventConsumer');
    const enqueueModule = os(
      'infrastructure/service-bus/WorkEnqueuedEventConsumer',
    );
    const charge = new chargeModule.ChargeEventConsumer(
      new (os('infrastructure/saga/ReceberCobranca').ReceiveChargeEvent)(db),
      chargeModule.chargeEventValidator(dir),
    );
    const payment = new paymentModule.PaymentEventConsumer(
      new (os('infrastructure/saga/ReceberPagamento').ReceivePaymentEvent)(db),
      paymentModule.paymentEventValidator(dir),
    );
    const enqueue = new enqueueModule.WorkEnqueuedEventConsumer(
      new (os(
        'infrastructure/saga/ReceberEnfileiramento',
      ).ReceiveWorkEnqueuedEvent)(db),
      enqueueModule.workEnqueuedEventValidator(dir),
    );
    subscribe(
      bus.createReceiver('bdd.events', 'bdd.os', { receiveMode: 'peekLock' }),
      {
        'execution.diagnosis-started.v1': diagnostic,
        'execution.diagnosis-completed.v1': diagnostic,
        'billing.quote-issued.v1': quote,
        'billing.quote-approved.v1': quote,
        'execution.parts-reserved.v1': reserve,
        'billing.charge-created.v1': charge,
        'billing.payment-confirmed.v1': payment,
        'execution.work-enqueued.v1': enqueue,
        'execution.work-started.v1': repair,
        'execution.work-completed.v1': repair,
      },
    );
    actions.open = (d) =>
      new (os('infrastructure/saga/AbrirOrdem').OpenOrderWithSaga)(db).execute(
        d,
      );
    actions.deliver = (d) =>
      new (os('infrastructure/saga/EntregarOrdem').DeliverOrder)(db).execute(
        d.osId,
      );
    actions.compensate = (d) => new (os('infrastructure/saga/IniciarCompensacao').StartCompensation)(db).execute(d.sagaId, 'STEP_FAILED');
  } else if (c.role === 'billing') {
    const { PrismaClient } = require(
      path.join(c.billingDir, 'node_modules/@prisma/client'),
    );
    db = new PrismaClient({ datasources: { db: { url: c.billingUrl } } });
    let refunded = false; let refundCalls = 0;
    actions.refundCalls = async () => refundCalls;
    const refundId = `REF${c.tag.replaceAll('-', '').slice(0, 26)}`;
    provider = {
      create: async (input) => ({
        id: c.providerOrder,
        type: 'qr',
        external_reference: input.externalReference,
        currency: 'BRL',
        total_amount: (input.amountInCents / 100).toFixed(2),
        status: 'created',
        type_response: { qr_data: 'QR-TEST' },
      }),
      get: async () => {
        const charge = await db.charge.findFirstOrThrow({
          where: { providerOrderId: c.providerOrder },
        });
        return {
          id: c.providerOrder,
          type: 'qr',
          external_reference: charge.externalReference,
          currency: 'BRL',
          total_amount: '10.00',
          status: refunded ? 'refunded' : 'processed',
          status_detail: 'accredited',
          transactions: {
            payments: [
              {
                id: `txn-${c.tag}`,
                reference_id: c.providerPayment,
                status: refunded ? 'refunded' : 'processed',
                status_detail: 'accredited',
                paid_amount: '10.00',
                ...(refunded ? { refunded_amount: '10.00' } : {}),
              },
            ],
            ...(refunded ? { refunds: [{ id: refundId, transaction_id: `txn-${c.tag}`, status: 'processed', amount: '10.00' }] } : {}),
          },
        };
      },
      refund: async () => { refundCalls++; refunded = true; return { id: c.providerOrder, transactions: { refunds: [{ id: refundId, transaction_id: `txn-${c.tag}` }] } }; },
      getPayment: async () => ({
        id: Number(c.providerPayment),
        status: 'approved',
        status_detail: 'accredited',
        currency_id: 'BRL',
        transaction_amount: 10,
        transaction_amount_refunded: 0,
        date_approved: new Date().toISOString(),
      }),
    };
    const { OutboxDispatcher } = b('application/publicar-outbox');
    const dispatch = new OutboxDispatcher(db, {
      publish: async ({ payload }) => send(topic, payload),
    });
    poll(() => dispatch.dispatchOne());
    const d = path.join(c.billingDir, 'docs/contracts/messages');
    const q = b('infrastructure/service-bus/command-consumer');
    const ch = b('infrastructure/service-bus/charge-consumer');
    const quote = new q.ServiceBusCommandConsumer(
      new (b('application/gerar-orcamento').GenerateQuoteService)(db),
      q.createQuoteCommandValidator(d),
    );
    const charge = new ch.ChargeCommandConsumer(
      new (b('application/preparar-cobranca').PrepareChargeService)(db),
      new (b('application/enviar-cobranca').SubmitChargeService)(db, provider),
      ch.createChargeCommandValidator(d),
    );
    subscribe(
      bus.createReceiver('bdd.billing.commands', { receiveMode: 'peekLock' }),
      {
        'billing.generate-quote.v1': quote,
        'billing.create-charge.v1': charge,
      },
    );
    actions.approve = (d) =>
      new (b('application/decidir-orcamento').QuoteDecisionService)(db).execute(
        d,
      );
    actions.pay = async () => {
      const eventId = `hook-${c.tag}`;
      await db.receivedWebhook.create({
        data: {
          provider: 'mercado-pago-orders',
          eventId,
          status: 'RECEIVED',
          payload: {
            type: 'order',
            action: 'order.processed',
            data: { id: c.providerOrder },
          },
        },
      });
      return new (b('application/processar-webhook').ProcessMercadoPagoWebhook)(
        db,
        provider,
      ).execute(eventId);
    };
  } else if (c.role === 'execution') {
    const { CosmosClient } = require(
      path.join(c.execDir, 'node_modules/@azure/cosmos'),
    );
    cosmos = new CosmosClient({
      endpoint: c.cosmosEndpoint,
      key: Buffer.from('local-test-key').toString('base64'),
    });
    const container = cosmos.database(c.cosmosDatabase).container('operations');
    executionContainer = container;
    const dispatch = new (e(
      'infrastructure/cosmos/outbox',
    ).CosmosOutboxDispatcher)(container, {
      publish: async ({ payload }) => send(topic, payload),
    });
    poll(() => dispatch.dispatchOne());
    const d = path.join(c.execDir, 'docs/contracts/messages');
    const di = e('infrastructure/service-bus/diagnosis-consumer');
    const re = e('infrastructure/service-bus/reserve-consumer');
    const en = e('infrastructure/service-bus/enqueue-consumer');
    const diagnosis = new di.DiagnosisCommandConsumer(
      new (e('infrastructure/cosmos/diagnostico').CosmosDiagnosisStore)(
        container,
      ),
      di.createDiagnosisValidator(d),
    );
    const reserve = new re.ReserveCommandConsumer(
      new (e('infrastructure/cosmos/reservas').CosmosReservationStore)(
        container,
      ),
      re.createReserveValidator(d),
    );
    const enqueue = new en.EnqueueCommandConsumer(
      new (e('infrastructure/cosmos/enfileirar').CosmosEnqueueStore)(container),
      en.createEnqueueValidator(d),
    );
    subscribe(
      bus.createReceiver('bdd.execution.commands', { receiveMode: 'peekLock' }),
      {
        'execution.request-diagnosis.v1': diagnosis,
        'execution.reserve-parts.v1': reserve,
        'execution.enqueue-work.v1': enqueue,
      },
    );
    const diagnosisActions = new (e(
      'infrastructure/cosmos/diagnostico-operacoes',
    ).CosmosDiagnosisActions)(container);
    const work = new (e('infrastructure/cosmos/reparo').CosmosWorkStore)(
      container,
    );
    actions.seed = async () => {
      await diagnosisActions.putCatalog('branch', {
        sourceId: 'p1',
        itemType: 'PART',
        name: 'Peca',
        unitPriceInCents: 500,
        active: true,
      });
      await container.items.create({
        id: 'stock:p1',
        filialId: 'branch',
        sku: 'p1',
        balance: c.noStock ? 0 : 5,
        reserved: 0,
      });
    };
    actions.diagnose = async (d) => {
      await diagnosisActions.apply('start', {
        ...d,
        operationId: `start-${c.tag}`,
      });
      await diagnosisActions.apply('complete', {
        ...d,
        operationId: `complete-${c.tag}`,
        items: [{ sourceId: 'p1', itemType: 'PART', quantity: 2 }],
      });
    };
    actions.start = async (d) => {
      const task = (await container.item(`task:${d.osId}`, 'branch').read())
        .resource;
      return work.start({
        ...d,
        executionId: task.executionId,
        messageId: `work-start-${c.tag}`,
        operationId: `work-start-${c.tag}`,
      });
    };
    actions.complete = async (d) => {
      const task = (await container.item(`task:${d.osId}`, 'branch').read())
        .resource;
      return work.complete({
        ...d,
        executionId: task.executionId,
        messageId: `work-end-${c.tag}`,
        operationId: `work-end-${c.tag}`,
      });
    };
  } else throw Error('Serviço inválido');
  let application;
  if (c.productionWorkers) {
    application = await startProductionWorkers(c, provider, () => allowRefund);
  }
  if (c.httpActions) {
    if (!application || !c.productionWorkers) throw Error('APIs HTTP exigem workers reais');
    const url = await application.getUrl();
    const jwt = require(path.join(c.role === 'os' ? root : c.role === 'billing' ? c.billingDir : c.execDir, 'node_modules/jsonwebtoken'));
    const admin = jwt.sign({ sub: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const request = async (method, route, body, key, token = admin) => {
      const traceId = c.traceTest && (route === '/fase4/ordens-servico' ? c.openTrace : route.includes('diagnostico') ? c.diagnosisTrace : undefined);
      const response = await fetch(`${url}${route}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}), ...(traceId ? { traceparent: `00-${traceId}-1111111111111111-01` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) throw Error(`HTTP ${method} ${route} retornou ${response.status}: ${await response.text()}`);
      return response.json();
    };
    if (c.role === 'os') {
      actions.open = d => request('POST', '/fase4/ordens-servico', { clienteId: d.clienteId, veiculoId: d.veiculoId, filialId: d.filialId }, d.key);
      actions.deliver = async d => (await request('POST', `/fase4/ordens-servico/${d.osId}/entregar`, {})).status;
      actions.compensate = async d => (await request('POST', `/fase4/ordens-servico/${d.sagaId}/compensar`, { reason: 'STEP_FAILED' })).status;
    } else if (c.role === 'billing') {
      actions.approve = d => {
        const customer = jwt.sign({ sub: d.clientId, role: 'cliente' }, process.env.JWT_CLIENT_SECRET, { issuer: 'soat-auth-function', audience: 'soat-api', expiresIn: '1h' });
        return request('POST', `/orcamentos/${d.quoteId}/aprovar`, { versao: d.version }, d.idempotencyKey, customer);
      };
    } else {
      actions.diagnose = async d => {
        const base = { sagaId: d.sagaId, filialId: d.filialId, correlationId: d.correlationId };
        await request('POST', `/execucoes/${d.osId}/iniciar-diagnostico`, base, `start-${c.tag}`);
        await request('POST', `/execucoes/${d.osId}/concluir-diagnostico`, { ...base, items: [{ sourceId: 'p1', itemType: 'PART', quantity: 2 }] }, `complete-${c.tag}`);
      };
      const repair = async (verb, d) => {
        const task = (await executionContainer.item(`task:${d.osId}`, 'branch').read()).resource;
        return request('POST', `/execucoes/${d.osId}/${verb}`, { sagaId: d.sagaId, filialId: d.filialId, executionId: task.executionId, correlationId: d.correlationId }, `work-${verb}-${c.tag}`);
      };
      actions.start = d => repair('iniciar', d);
      actions.complete = d => repair('finalizar', d);
    }
  }
  close = async () => {
    await application?.close();
    for (const timer of timerRefs) clearInterval(timer);
    await Promise.allSettled(subscriptions.map((x) => x.close()));
    await Promise.allSettled(receivers.map((x) => x.close()));
    await Promise.allSettled([
      osQueue.close(),
      billingQueue.close(),
      topic.close(),
    ]);
    await bus.close();
    await db?.$disconnect();
    cosmos?.dispose();
  };
}

// Adapta somente as fronteiras de rede deste processo de teste. Os próprios
// workers, roteamento, assinatura, ACK, polling e ciclo Nest são de produção.
async function startProductionWorkers(c, provider, canProcessRefund) {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const roleDir = c.role === 'os' ? root : c.role === 'billing' ? c.billingDir : c.execDir;
  const roleRequire = Module.createRequire(path.join(roleDir, 'package.json'));
  const realBus = roleRequire('@azure/service-bus');
  const realCosmos = c.role === 'execution' ? roleRequire('@azure/cosmos') : undefined;
  const keys = c.keys;
  if (c.role === 'billing' && c.badEvidence) {
    const { RefundCommandProcessor } = require(path.join(roleDir, 'dist/infrastructure/service-bus/refund-command'));
    const original = RefundCommandProcessor.prototype.processOne;
    RefundCommandProcessor.prototype.processOne = function() {
      return canProcessRefund() ? original.call(this) : Promise.resolve('EMPTY');
    };
  }
  Object.assign(process.env, {
    AZURE_TENANT_ID: 'test', AZURE_CLIENT_ID: 'test', AZURE_FEDERATED_TOKEN_FILE: '/test-only',
    SERVICE_BUS_NAMESPACE: 'local-test.servicebus.windows.net',
    SERVICE_BUS_EVENT_TOPIC: 'bdd.events', SERVICE_BUS_COMMAND_QUEUE: `bdd.${c.role}.commands`,
    SERVICE_BUS_BILLING_QUEUE: 'bdd.billing.commands', SERVICE_BUS_EXECUTION_QUEUE: 'bdd.execution.commands',
    SERVICE_BUS_SAGA_SUBSCRIPTION: 'bdd.os', SERVICE_BUS_BILLING_EVIDENCE_SUBSCRIPTION: 'bdd.billing.evidence',
    OS_MESSAGE_PUBLIC_KEY: keys.os.publicKey, BILLING_MESSAGE_PUBLIC_KEY: keys.billing.publicKey,
    EXECUTION_MESSAGE_PUBLIC_KEY: keys.execution.publicKey, MERCADO_PAGO_EXTERNAL_POS_ID: 'pos-test',
    COSMOS_ENDPOINT: 'https://local-test.documents.azure.com', COSMOS_DATABASE: c.cosmosDatabase, COSMOS_CONTAINER: 'operations',
    JWT_SECRET: 'admin-local-secret-with-at-least-32-characters', JWT_CLIENT_SECRET: 'client-local-secret-with-at-least-32-characters', JWT_EXPIRES_IN: '1d', JWT_CLIENT_ISSUER: 'soat-auth-function', JWT_CLIENT_AUDIENCE: 'soat-api',
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: '$2b$10$12kw18n1pMwBIluxZQxh1O.zpsHVW.lRC9lmwyWCtKIOcC.49x5.O', MAIL_HOST: 'smtp.test.local', MAIL_PORT: '587', MAIL_USER: 'test@example.com', MAIL_PASS: 'test', MAIL_FROM: 'test@example.com', WEBHOOK_SECRET: 'test-webhook-secret-with-at-least-32-characters', WEBHOOK_TOKEN_EXPIRES_IN: '1h', APP_URL: 'http://localhost:3000',
  });
  if (c.role === 'os') Object.assign(process.env, { DATABASE_URL: c.osUrl, SAGA_DATABASE_URL: c.osUrl, OS_MESSAGE_PRIVATE_KEY: keys.os.privateKey, ENABLE_SAGA_COMMAND_PUBLISHER: 'true', ENABLE_SAGA_EVENT_CONSUMER: 'true', ENABLE_FASE4_OPEN: 'true', ENABLE_FASE4_DELIVERY: 'true', ENABLE_FASE4_COMPENSATION: 'true' });
  if (c.role === 'billing') Object.assign(process.env, { DATABASE_URL: c.billingUrl, BILLING_MESSAGE_PRIVATE_KEY: keys.billing.privateKey, ENABLE_SERVICE_BUS_WORKER: 'true', ENABLE_MERCADO_PAGO_COMMANDS: 'true', ENABLE_BILLING_COMPENSATION_EVIDENCE: 'true', ENABLE_MERCADO_PAGO_REFUND_COMMANDS: 'true', MERCADO_PAGO_ACCESS_TOKEN: 'local-fixture-only' });
  if (c.role === 'execution') Object.assign(process.env, { EXECUTION_MESSAGE_PRIVATE_KEY: keys.execution.privateKey, ENABLE_EXECUTION_COMMANDS: 'true', ENABLE_EXECUTION_OUTBOX: 'true' });
  process.chdir(roleDir);
  Module._load = function(request, parent, isMain) {
    if (request === '@azure/service-bus') return { ...realBus, ServiceBusClient: class { constructor() { return new realBus.ServiceBusClient(c.connection); } } };
    if (request === '@azure/cosmos' && realCosmos) return { ...realCosmos, CosmosClient: class { constructor() { return new realCosmos.CosmosClient({ endpoint: c.cosmosEndpoint, key: Buffer.from('local-test-key').toString('base64') }); } } };
    if (request === '@azure/identity') return { WorkloadIdentityCredential: class {} };
    if (c.role === 'billing' && request === '../mercado-pago/orders-client') return { MercadoPagoOrdersClient: class { constructor() { return provider; } } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { Module: NestModule } = roleRequire('@nestjs/common');
    const { NestFactory } = roleRequire('@nestjs/core');
    const dist = name => require(path.join(roleDir, 'dist', c.role === 'os' ? 'src' : '', name));
    const workers = c.role === 'os'
      ? [dist('infrastructure/service-bus/SagaCommandWorker').SagaCommandWorker, dist('infrastructure/service-bus/SagaEventWorker').SagaEventWorker]
      : c.role === 'billing'
        ? [dist('infrastructure/service-bus/worker').BillingMessageWorker]
        : [dist('infrastructure/service-bus/command-worker').ExecutionCommandWorker, dist('infrastructure/service-bus/outbox-worker').ExecutionOutboxWorker];
    class WorkersModule {}
    NestModule({ providers: workers })(WorkersModule);
    if (c.httpActions) {
      const appModule = dist('app.module').AppModule;
      const app = await NestFactory.create(appModule, { logger: ['error', 'warn'], abortOnError: false });
      if (c.traceTest) {
        // O SDK de teste extrai o cabeçalho recebido; a instrumentação HTTP real
        // é verificada separadamente pelos testes de observabilidade locais.
        const { context, propagation, ROOT_CONTEXT, trace } = roleRequire('@opentelemetry/api');
        app.use((req, res, next) => context.with(propagation.extract(ROOT_CONTEXT, req.headers), () =>
          trace.getTracer('soat-test-http').startActiveSpan('test inbound HTTP', span => {
            res.once('finish', () => span.end());
            next();
          })));
      }
      await app.listen(0, '127.0.0.1');
      return app;
    }
    return await NestFactory.createApplicationContext(WorkersModule, { logger: ['error', 'warn'], abortOnError: false });
  } finally { Module._load = originalLoad; }
}
