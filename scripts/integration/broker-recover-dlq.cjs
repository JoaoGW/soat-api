/* Testa recuperação de DLQ em broker local, com handler e Postgres reais. */
const assert = require('node:assert/strict');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { ServiceBusClient } = require('@azure/service-bus');
const {
  MessageSigner,
  MessageVerifier,
} = require('../../dist/src/infrastructure/messaging/message-signature');
const {
  RecoverSagaDlq,
} = require('../../dist/src/infrastructure/service-bus/RecoverSagaDlq');
const {
  failureEventValidator,
} = require('../../dist/src/infrastructure/service-bus/RepairEventConsumer');
const {
  ReceiveFailureEvent,
} = require('../../dist/src/infrastructure/saga/ReceberFalha');
const url = process.env.OS_TEST_DATABASE_URL,
  connection = process.env.SERVICE_BUS_TEST_CONNECTION_STRING;
if (!url) throw Error('Banco de teste obrigatório');
const parsed = new URL(url);
if (
  !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) ||
  !parsed.pathname.endsWith('_test')
)
  throw Error('Banco local de teste obrigatório');
if (
  !connection ||
  !/^Endpoint=sb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(connection) ||
  !/UseDevelopmentEmulator=true/i.test(connection)
)
  throw Error('Broker local obrigatório');
const db = new PrismaClient({ datasources: { db: { url } } }),
  bus = new ServiceBusClient(connection),
  sender = bus.createSender('bdd.billing.commands'),
  inbox = bus.createReceiver('bdd.billing.commands', {
    receiveMode: 'peekLock',
  }),
  dlq = bus.createReceiver('bdd.billing.commands', {
    receiveMode: 'peekLock',
    subQueueType: 'deadLetter',
  });
async function main() {
  const tag = randomUUID(),
    client = `client-${tag}`,
    vehicle = `vehicle-${tag}`,
    osId = `os-${tag}`,
    sagaId = `saga-${tag}`,
    operationId = `op-${tag}`,
    messageId = `msg-${tag}`,
    doc = String(
      BigInt('0x' + tag.replaceAll('-', '').slice(0, 10)) % 100000000000n,
    ).padStart(11, '0');
  await db.$executeRaw`INSERT INTO "Cliente" ("id","nome","documento","tipo","contato","updatedAt") VALUES (${client},'T',${doc},'PF','x',NOW())`;
  await db.$executeRaw`INSERT INTO "Veiculo" ("id","clienteId","placa","marca","modelo","ano","updatedAt") VALUES (${vehicle},${client},${tag.slice(0, 7)},'X','Y',2020,NOW())`;
  await db.$executeRaw`INSERT INTO "OrdemDeServico" ("id","codigoAcompanhamento","clienteId","veiculoId","filialId","status","updatedAt") VALUES (${osId},${tag},${client},${vehicle},'branch','RECEBIDA',NOW())`;
  await db.$executeRaw`INSERT INTO "SagaInstance" ("id","osId","filialId","status","updatedAt") VALUES (${sagaId},${osId},'branch','ORCAMENTO_PENDENTE',NOW())`;
  await db.$executeRaw`INSERT INTO "SagaOperation" ("operationId","sagaId","step","businessAttempt","commandType","status","updatedAt") VALUES (${operationId},${sagaId},'GENERATE_QUOTE',1,'billing.generate-quote.v1','PENDING',NOW())`;
  const command = {
    operationId,
    sagaId,
    data: { diagnosisId: osId, diagnosisVersion: 1 },
  };
  await db.$executeRaw`INSERT INTO "Outbox" ("messageId","type","payload","status") VALUES (${`cmd-${tag}`},'billing.generate-quote.v1',${JSON.stringify(command)}::jsonb,'SENT')`;
  const event = {
    messageId,
    type: 'billing.quote-failed.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    producer: 'soat-billing-service',
    aggregateType: 'quote-command',
    aggregateId: operationId,
    aggregateVersion: 1,
    osId,
    sagaId,
    filialId: 'branch',
    correlationId: sagaId,
    causationId: `cmd-${tag}`,
    operationId,
    data: { reasonCode: 'EXPIRED', diagnosisId: osId, diagnosisVersion: 1 },
  };
  const keys = generateKeyPairSync('ed25519');
  const signer = new MessageSigner(
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  );
  const verifier = new MessageVerifier(
    keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    'soat-billing-service',
  );
  await sender.sendMessages({
    messageId,
    subject: event.type,
    body: event,
    applicationProperties: { signature: signer.sign(event) },
  });
  const received = await inbox.receiveMessages(1, { maxWaitTimeInMs: 15000 });
  assert.equal(received.length, 1);
  assert.equal(received[0].messageId, messageId);
  await inbox.deadLetterMessage(received[0], {
    deadLetterReason: 'TestFailure',
  });
  const dead = await dlq.receiveMessages(1, { maxWaitTimeInMs: 15000 });
  assert.equal(dead.length, 1);
  const handler = new ReceiveFailureEvent(db);
  const route = {
    validate: failureEventValidator(path.resolve('docs/contracts/messages')),
    execute: (body) => handler.execute(body),
  };
  assert.equal(
    await new RecoverSagaDlq(
      db,
      { 'soat-billing-service': verifier },
      { [event.type]: route },
    ).execute(dead[0], dlq, {
      expectedMessageId: messageId,
      actorId: 'test-operator',
      reason: 'TEST_RECOVERY',
    }),
    'APPLIED',
  );
  const state =
    await db.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${sagaId}`;
  assert.equal(state[0].status, 'COMPENSANDO');
  const audit =
    await db.$queryRaw`SELECT count(*) AS count FROM "SagaRecoveryAudit" WHERE "messageId"=${messageId}`;
  assert.equal(audit[0].count, 1n);
  assert.equal(
    (await dlq.receiveMessages(1, { maxWaitTimeInMs: 1000 })).length,
    0,
  );
  process.stdout.write(
    'Evento assinado recuperado da DLQ local e aplicado uma vez na Saga.\n',
  );
}
main()
  .finally(async () => {
    await Promise.allSettled([inbox.close(), dlq.close(), sender.close()]);
    await bus.close();
    await db.$disconnect();
  })
  .catch((e) => {
    console.error(e.stack || e);
    process.exitCode = 1;
  });
