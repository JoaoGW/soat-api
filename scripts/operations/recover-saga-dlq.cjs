/* Recupera um evento selecionado da DLQ do OS usando os handlers normais. */
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { WorkloadIdentityCredential } = require('@azure/identity');
const { ServiceBusClient } = require('@azure/service-bus');
const root = path.resolve(__dirname, '../../dist/src/infrastructure');
const get = (p) => require(path.join(root, p));
const { MessageVerifier } = get('messaging/message-signature');
const { RecoverSagaDlq } = get('service-bus/RecoverSagaDlq');
const env = process.env;
const id = env.SAGA_DLQ_MESSAGE_ID,
  actorId = env.SAGA_DLQ_ACTOR,
  reason = env.SAGA_DLQ_REASON;
if (
  env.ENABLE_SAGA_DLQ_RECOVERY !== 'true' ||
  ![id, actorId, reason].every(
    (x) => typeof x === 'string' && /^[a-z0-9_@.-]{1,128}$/i.test(x),
  ) ||
  !env.SAGA_DATABASE_URL ||
  !env.BILLING_MESSAGE_PUBLIC_KEY ||
  !env.EXECUTION_MESSAGE_PUBLIC_KEY ||
  !env.SERVICE_BUS_NAMESPACE ||
  !/^[a-z0-9-]+\.servicebus\.windows\.net$/i.test(env.SERVICE_BUS_NAMESPACE) ||
  !env.SERVICE_BUS_EVENT_TOPIC ||
  !env.SERVICE_BUS_SAGA_SUBSCRIPTION ||
  !env.AZURE_TENANT_ID ||
  !env.AZURE_CLIENT_ID ||
  !env.AZURE_FEDERATED_TOKEN_FILE
)
  throw Error('Configuração incompleta da recuperação da DLQ');
const dbUrl = new URL(env.SAGA_DATABASE_URL);
if (
  !['postgres:', 'postgresql:'].includes(dbUrl.protocol) ||
  !dbUrl.hostname ||
  dbUrl.pathname === '/'
)
  throw Error('Banco da Saga inválido');
const db = new PrismaClient({
  datasources: { db: { url: env.SAGA_DATABASE_URL } },
});
const bus = new ServiceBusClient(
  env.SERVICE_BUS_NAMESPACE,
  new WorkloadIdentityCredential(),
);
const receiver = bus.createReceiver(
  env.SERVICE_BUS_EVENT_TOPIC,
  env.SERVICE_BUS_SAGA_SUBSCRIPTION,
  { subQueueType: 'deadLetter', receiveMode: 'peekLock' },
);
const dir = path.resolve('docs/contracts/messages');
const multi = get('service-bus/RepairEventConsumer');
const charge = get('service-bus/ChargeEventConsumer');
const pay = get('service-bus/PaymentEventConsumer');
const enq = get('service-bus/WorkEnqueuedEventConsumer');
const routes = {};
function add(types, validate, handler) {
  for (const type of types)
    routes[type] = { validate, execute: (event) => handler.execute(event) };
}
add(
  [
    'billing.quote-failed.v1',
    'billing.charge-failed.v1',
    'execution.parts-reservation-failed.v1',
  ],
  multi.failureEventValidator(dir),
  new (get('saga/ReceberFalha').ReceiveFailureEvent)(db),
);
add(
  [
    'billing.quote-issued.v1',
    'billing.quote-approved.v1',
    'billing.quote-rejected.v1',
  ],
  multi.quoteEventValidator(dir),
  new (get('saga/ReceberOrcamento').ReceiveQuoteEvent)(db),
);
add(
  ['execution.diagnosis-started.v1', 'execution.diagnosis-completed.v1'],
  multi.diagnosisEventValidator(dir),
  new (get('saga/ReceberDiagnostico').ReceiveDiagnosisEvent)(db),
);
add(
  ['execution.parts-reserved.v1'],
  multi.reservationEventValidator(dir),
  new (get('saga/ReceberReserva').ReceiveReservationEvent)(
    db,
    env.MERCADO_PAGO_EXTERNAL_POS_ID,
  ),
);
add(
  ['billing.charge-created.v1'],
  charge.chargeEventValidator(dir),
  new (get('saga/ReceberCobranca').ReceiveChargeEvent)(db),
);
add(
  ['billing.payment-confirmed.v1'],
  pay.paymentEventValidator(dir),
  new (get('saga/ReceberPagamento').ReceivePaymentEvent)(db),
);
add(
  ['execution.work-enqueued.v1'],
  enq.workEnqueuedEventValidator(dir),
  new (get('saga/ReceberEnfileiramento').ReceiveWorkEnqueuedEvent)(db),
);
add(
  ['execution.work-started.v1', 'execution.work-completed.v1'],
  multi.repairEventValidator(dir),
  new (get('saga/ReceberReparo').ReceiveRepairEvent)(db),
);
add(
  ['execution.work-cancelled.v1'],
  multi.cancellationEventValidator(dir),
  new (get('saga/ReceberCancelamento').ReceiveCancellationEvent)(db),
);
add(
  ['billing.payment-refunded.v1'],
  multi.refundEventValidator(dir),
  new (get('saga/ReceberReembolso').ReceiveRefundEvent)(db),
);
add(
  ['execution.parts-released.v1'],
  multi.releaseEventValidator(dir),
  new (get('saga/ReceberLiberacao').ReceiveReleaseEvent)(db),
);
const verifiers = {
  'soat-billing-service': new MessageVerifier(
    env.BILLING_MESSAGE_PUBLIC_KEY,
    'soat-billing-service',
  ),
  'soat-execution-service': new MessageVerifier(
    env.EXECUTION_MESSAGE_PUBLIC_KEY,
    'soat-execution-service',
  ),
};
async function main() {
  const messages = await receiver.receiveMessages(1, { maxWaitTimeInMs: 5000 });
  if (!messages.length) throw Error('DLQ vazia');
  const message = messages[0];
  try {
    const result = await new RecoverSagaDlq(db, verifiers, routes).execute(
      message,
      receiver,
      { expectedMessageId: id, actorId, reason },
    );
    process.stdout.write(`Evento recuperado: ${result}\n`);
  } catch (error) {
    await receiver.abandonMessage(message);
    throw error;
  }
}
main()
  .finally(async () => {
    await receiver.close();
    await bus.close();
    await db.$disconnect();
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
