/* Local OS/Billing acceptance; Execution cancellation and Mercado Pago are fixtures. */
const assert = require('node:assert/strict');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const { resolve } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { ServiceBusClient } = require('@azure/service-bus');
const billingRoot = process.env.BILLING_REPO_DIR;
const osUrl = process.env.OS_TEST_DATABASE_URL, billingUrl = process.env.BILLING_TEST_DATABASE_URL, connection = process.env.SERVICE_BUS_TEST_CONNECTION_STRING;
for (const value of [osUrl, billingUrl]) { if (!value || !['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname) || !new URL(value).pathname.endsWith('_test')) throw Error('Bancos locais de teste obrigatórios'); }
if (!billingRoot || !connection || !/^Endpoint=sb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(connection) || !/UseDevelopmentEmulator=true/i.test(connection)) throw Error('Billing e broker local obrigatórios');
const fromBilling = file => require(resolve(billingRoot, 'dist', file));
const { PrismaClient: BillingPrisma } = require(resolve(billingRoot, 'node_modules/@prisma/client'));
const { MessageSigner, MessageVerifier } = fromBilling('infrastructure/service-bus/message-signature');
const { CompensationEvidenceConsumer, evidenceValidator } = fromBilling('infrastructure/service-bus/compensation-evidence');
const { CancelChargeCommandConsumer, CancelChargeCommandProcessor, cancelChargeValidator } = fromBilling('infrastructure/service-bus/cancel-charge-command');
const { PrepareChargeCancellation, CancelChargeService } = fromBilling('application/cancelar-cobranca');
const { StartCompensation } = require('../../dist/src/infrastructure/saga/IniciarCompensacao');
const { ReceiveCancellationEvent } = require('../../dist/src/infrastructure/saga/ReceberCancelamento');
const { ReceiveChargeCancellation } = require('../../dist/src/infrastructure/saga/ReceberCancelamentoCobranca');
const { ChargeCancellationEventConsumer, chargeCancellationEventValidator } = require('../../dist/src/infrastructure/service-bus/ChargeCancellationEventConsumer');
const db = new PrismaClient({ datasources: { db: { url: osUrl } } }), billing = new BillingPrisma({ datasources: { db: { url: billingUrl } } });
const bus = new ServiceBusClient(connection), sender = bus.createSender('bdd.billing.commands'), queue = bus.createReceiver('bdd.billing.commands', { receiveMode: 'peekLock' });
const keys = producer => { const pair = generateKeyPairSync('ed25519'); return { signer: new MessageSigner(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()), verifier: new MessageVerifier(pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), producer) }; };
async function deliver(body, key, handler) {
  await sender.sendMessages({ messageId: body.messageId, subject: body.type, body, applicationProperties: { signature: key.signer.sign(body) } });
  const messages = await queue.receiveMessages(1, { maxWaitTimeInMs: 15000 }); assert.equal(messages.length, 1);
  if (messages[0].messageId !== body.messageId) { await queue.abandonMessage(messages[0]); throw Error('Fila não isolada'); }
  assert.equal(key.verifier.verify(messages[0].body, messages[0].applicationProperties?.signature), true);
  await handler(messages[0]);
}
async function main() {
  const id = randomUUID(), osId = `os-${id}`, sagaId = `saga-${id}`, customer = `client-${id}`, vehicle = `vehicle-${id}`, chargeId = `charge-${id}`, quoteId = `quote-${id}`, reservationId = `reserve-${id}`, orderId = `ORD${randomUUID().replaceAll('-', '').slice(0, 26)}`;
  const document = String(BigInt('0x' + id.replaceAll('-', '').slice(0, 10)) % 100000000000n).padStart(11, '0');
  await db.$executeRaw`INSERT INTO "Cliente" ("id","nome","documento","tipo","contato","updatedAt") VALUES (${customer},'Teste',${document},'PF','test@example.test',NOW())`;
  await db.$executeRaw`INSERT INTO "Veiculo" ("id","clienteId","placa","marca","modelo","ano","updatedAt") VALUES (${vehicle},${customer},${id.slice(0, 7)},'X','Y',2020,NOW())`;
  await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id","codigoAcompanhamento","clienteId","veiculoId","filialId","status","updatedAt") VALUES (${osId},${id},${customer},${vehicle},'branch','AGUARDANDO_PAGAMENTO',NOW())`;
  await db.$executeRaw`INSERT INTO "SagaInstance" ("id","osId","filialId","status","quoteId","quoteVersion","reservationId","chargeId","updatedAt") VALUES (${sagaId},${osId},'branch','AGUARDANDO_PAGAMENTO',${quoteId},1,${reservationId},${chargeId},NOW())`;
  const result = { data: { chargeId, providerOrderId: orderId } };
  await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId","sagaId","step","businessAttempt","commandType","status","result","updatedAt") VALUES (${`charge-op-${id}`},${sagaId},'CREATE_CHARGE',1,'billing.create-charge.v1','SUCCEEDED',${JSON.stringify(result)}::jsonb,NOW())`;
  await billing.quote.create({ data: { id: quoteId, osId, sagaId, filialId: 'branch', clientId: customer, version: 1, totalInCents: 500, status: 'APPROVED', expiresAt: new Date(Date.now()+900000) } });
  await billing.charge.create({ data: { id: chargeId, quoteId, osId, status: 'CREATED', amountInCents: 500, externalReference: chargeId, providerOrderId: orderId, expiresAt: new Date(Date.now()+900000), attempts: { create: { id: `attempt-${id}`, operationId: `charge-op-${id}`, providerKey: `key-${id}`, status: 'CREATED', result: { reservationId, sagaId, filialId: 'branch' } } } } });
  await new StartCompensation(db).execute(sagaId, 'SAGA_COMPENSATION');
  const [cancel] = await db.$queryRaw`SELECT "operationId" FROM "SagaOperation" WHERE "sagaId"=${sagaId} AND "commandType"='execution.cancel-work.v1'`;
  const evidence = { messageId: `evidence-${id}`, operationId: cancel.operationId, type: 'execution.work-cancelled.v1', schemaVersion: 1, occurredAt: new Date().toISOString(), producer: 'soat-execution-service', aggregateType: 'execution', aggregateId: sagaId, aggregateVersion: 1, osId, sagaId, filialId: 'branch', correlationId: id, causationId: `cause-${id}`, traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01', tracestate: 'vendor=state', data: { outcome: 'CANCELLED', reason: 'SAGA_COMPENSATION' } };
  const osKey = keys('soat-os-service'), executionKey = keys('soat-execution-service'), billingKey = keys('soat-billing-service');
  await deliver(evidence, executionKey, async message => { await new ReceiveCancellationEvent(db, true).execute(message.body); await queue.completeMessage(message); });
  const bDir = resolve(billingRoot, 'docs/contracts/messages'), osDir = resolve('docs/contracts/messages');
  await deliver(evidence, executionKey, message => new CompensationEvidenceConsumer(billing, executionKey.verifier, evidenceValidator(bDir)).process(message, queue));
  const [commandRow] = await db.$queryRaw`SELECT "payload" FROM "Outbox" WHERE "type"='billing.cancel-charge.v1' AND "payload"->>'sagaId'=${sagaId}`;
  assert.ok(commandRow); const command = commandRow.payload, validate = cancelChargeValidator(bDir);
  assert.equal(command.traceparent, evidence.traceparent);
  await deliver(command, osKey, message => new CancelChargeCommandConsumer(billing, validate).process(message, queue));
  const payment = { id: `tx-${id}`, status: 'created', status_detail: 'created', paid_amount: '0.00' }, order = { id: orderId, type: 'qr', external_reference: chargeId, currency: 'BRL', total_amount: '5.00', status: 'created', transactions: { payments: [payment] } };
  const canceled = { ...order, status: 'canceled', status_detail: 'canceled', transactions: { payments: [{ ...payment, status: 'canceled', status_detail: 'canceled_by_api' }] } };
  let reads=0, mutations=0; const provider = { get: async () => ++reads === 1 ? order : canceled, cancel: async () => { mutations++; return {}; } };
  const processor = new CancelChargeCommandProcessor(billing, new PrepareChargeCancellation(billing), new CancelChargeService(billing, provider), validate); processor.cursor = command.messageId.slice(0,-1);
  assert.equal(await processor.processOne(), 'CANCELED'); assert.equal(mutations, 1);
  const [outbox] = await billing.outbox.findMany({ where: { type: 'billing.charge-canceled.v1', payload: { path: ['sagaId'], equals: sagaId } } }); assert.ok(outbox);
  assert.equal(outbox.payload.traceparent, evidence.traceparent);
  const receiver = new ChargeCancellationEventConsumer(new ReceiveChargeCancellation(db), chargeCancellationEventValidator(osDir));
  await deliver(outbox.payload, billingKey, message => receiver.process(message, queue));
  const [saga] = await db.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${sagaId}`; assert.equal(saga.status, 'LIBERACAO_PENDENTE');
  const release = await db.$queryRaw`SELECT "payload" FROM "Outbox" WHERE "type"='execution.release-parts.v1' AND "payload"->>'sagaId'=${sagaId}`; assert.equal(release.length, 1); assert.equal(release[0].payload.traceparent, evidence.traceparent);
  await billing.outbox.delete({ where: { messageId: outbox.messageId } });
  await db.$executeRaw`DELETE FROM "Outbox" WHERE "payload"->>'sagaId'=${sagaId}`;
  process.stdout.write('OS e Billing trocaram cancelamento assinado pelo broker e prepararam liberação uma vez.\n');
}
main().finally(async () => { await queue.close(); await sender.close(); await bus.close(); await db.$disconnect(); await billing.$disconnect(); }).catch(error => { console.error(error.stack); process.exitCode = 1; });
