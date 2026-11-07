/* Broker integration slice: OS diagnosis -> Service Bus -> Billing. Not full BDD. */
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const { ServiceBusClient } = require('@azure/service-bus');
const { MessageSigner, MessageVerifier } = require('../../dist/src/infrastructure/messaging/message-signature');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PrismaClient: OsPrisma } = require('@prisma/client');
const { ReceiveDiagnosisEvent } = require('../../dist/src/infrastructure/saga/ReceberDiagnostico');
const connection = process.env.SERVICE_BUS_TEST_CONNECTION_STRING;
if (!connection || !/^Endpoint=sb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(connection) || !/UseDevelopmentEmulator=true/i.test(connection)) throw new Error('É necessário um broker emulador local explícito');
const bus = new ServiceBusClient(connection);
const sender = bus.createSender('bdd.billing.commands');
const receiver = bus.createReceiver('bdd.billing.commands', { receiveMode: 'peekLock' });
const keys = generateKeyPairSync('ed25519');
const signer = new MessageSigner(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
const verifier = new MessageVerifier(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'soat-os-service');
const billingDir = process.env.BILLING_REPO_DIR;
const osUrl = process.env.OS_TEST_DATABASE_URL;
const billingUrl = process.env.BILLING_TEST_DATABASE_URL;
for (const value of [osUrl, billingUrl]) {
  if (!value) throw new Error('OS_TEST_DATABASE_URL e BILLING_TEST_DATABASE_URL são obrigatórias');
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('São exigidos bancos locais terminados em _test');
}
if (osUrl === billingUrl || !billingDir || !path.isAbsolute(billingDir)) throw new Error('Use bancos separados e BILLING_REPO_DIR absoluto');
const { PrismaClient: BillingPrisma } = require(path.join(billingDir, 'node_modules/@prisma/client'));
const { GenerateQuoteService } = require(path.join(billingDir, 'dist/application/gerar-orcamento'));
const { ServiceBusCommandConsumer, createQuoteCommandValidator } = require(path.join(billingDir, 'dist/infrastructure/service-bus/command-consumer'));
const os = new OsPrisma({ datasources: { db: { url: osUrl } } });
const billing = new BillingPrisma({ datasources: { db: { url: billingUrl } } });
async function main() {
  const id = randomUUID(); const client = `client-${id}`; const vehicle = `vehicle-${id}`; const osId = `os-${id}`; const sagaId = `saga-${id}`;
  const document = String(BigInt('0x' + id.replaceAll('-', '').slice(0, 10)) % 100000000000n).padStart(11, '0');
  await os.$executeRaw`INSERT INTO "Cliente" ("id", "nome", "documento", "tipo", "contato", "updatedAt") VALUES (${client}, 'Teste', ${document}, 'PF', 'client@example.test', NOW())`;
  await os.$executeRaw`INSERT INTO "Veiculo" ("id", "clienteId", "placa", "marca", "modelo", "ano", "updatedAt") VALUES (${vehicle}, ${client}, ${id.slice(0, 7)}, 'X', 'Y', 2020, NOW())`;
  await os.$executeRaw`INSERT INTO "OrdemDeServico" ("id", "codigoAcompanhamento", "clienteId", "veiculoId", "filialId", "status", "updatedAt") VALUES (${osId}, ${id}, ${client}, ${vehicle}, 'branch', 'RECEBIDA', NOW())`;
  await os.$executeRaw`INSERT INTO "SagaInstance" ("id", "osId", "filialId", "status", "updatedAt") VALUES (${sagaId}, ${osId}, 'branch', 'DIAGNOSTICO_PENDENTE', NOW())`;
  await os.$executeRaw`INSERT INTO "SagaOperation" ("operationId", "sagaId", "step", "businessAttempt", "commandType", "status", "updatedAt") VALUES (${`request-${id}`}, ${sagaId}, 'REQUEST_DIAGNOSIS', 1, 'execution.request-diagnosis.v1', 'SENT', NOW())`;
  const handler = new ReceiveDiagnosisEvent(os);
  const start = { messageId: `start-${id}`, operationId: `start-op-${id}`, type: 'execution.diagnosis-started.v1', producer: 'soat-execution-service', osId, sagaId, filialId: 'branch', correlationId: id, data: { diagnosisId: osId, diagnosisVersion: 2 } };
  const completed = { ...start, messageId: `finish-${id}`, operationId: `finish-op-${id}`, type: 'execution.diagnosis-completed.v1', data: { diagnosisId: osId, diagnosisVersion: 3, items: [{ sourceId: 'p1', itemType: 'PART', quantity: 2, unitPriceInCents: 500 }] } };
  await handler.execute(start); await handler.execute(completed);
  const rows = await os.$queryRaw`SELECT "payload" FROM "Outbox" WHERE "type" = 'billing.generate-quote.v1' AND "payload"->>'sagaId' = ${sagaId}`;
  assert.equal(rows.length, 1);
  const payload = rows[0].payload;
  const consumer = new ServiceBusCommandConsumer(new GenerateQuoteService(billing), createQuoteCommandValidator(path.join(billingDir, 'docs/contracts/messages')));
  const outbound = { messageId: payload.messageId, subject: payload.type, contentType: 'application/json', body: payload, applicationProperties: { signature: signer.sign(payload) } };
  await sender.sendMessages(outbound); await sender.sendMessages(outbound);
  for (let i = 0; i < 2; i++) {
    const messages = await receiver.receiveMessages(1, { maxWaitTimeInMs: 15000 });
    assert.equal(messages.length, 1, 'broker não entregou mensagem');
    const received = messages[0];
    if (!verifier.verify(received.body, received.applicationProperties?.signature)) throw new Error('Assinatura inválida');
    await consumer.process(received, receiver);
  }
  const quote = await billing.quote.findFirst({ where: { osId }, include: { items: true } });
  assert.ok(quote); assert.equal(quote.totalInCents, 1000); assert.equal(quote.items[0].unitPriceInCents, 500); assert.equal(quote.clientId, client);
  assert.equal(await billing.outbox.count({ where: { type: 'billing.quote-issued.v1', payload: { path: ['sagaId'], equals: sagaId } } }), 1);
  process.stdout.write('OS → broker → Billing: mensagem e reentrega processadas; outros serviços e Saga completa não foram exercitados.\n');
}
main().finally(async () => { await receiver.close(); await sender.close(); await bus.close(); await os.$disconnect(); await billing.$disconnect(); }).catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
