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
  let db, cosmos;
  function poll(fn) {
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
  } else if (c.role === 'billing') {
    const { PrismaClient } = require(
      path.join(c.billingDir, 'node_modules/@prisma/client'),
    );
    db = new PrismaClient({ datasources: { db: { url: c.billingUrl } } });
    const provider = {
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
          status: 'processed',
          status_detail: 'accredited',
          transactions: {
            payments: [
              {
                id: `txn-${c.tag}`,
                reference_id: c.providerPayment,
                status: 'processed',
                status_detail: 'accredited',
                paid_amount: '10.00',
              },
            ],
          },
        };
      },
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
        balance: 5,
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
  close = async () => {
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
