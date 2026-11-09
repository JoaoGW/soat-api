/* Local cross-service integration. Broker and Cosmos are not covered here. */
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PrismaClient: OsPrisma } = require('@prisma/client');
const { ReceiveDiagnosisEvent } = require('../../dist/src/infrastructure/saga/ReceberDiagnostico');
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
  const quoteService = new GenerateQuoteService(billing);
  const first = await quoteService.execute(rows[0].payload); const duplicate = await quoteService.execute(rows[0].payload);
  assert.deepEqual(duplicate, first);
  const quote = await billing.quote.findUnique({ where: { id: first.quoteId }, include: { items: true } });
  assert.equal(quote.totalInCents, 1000); assert.equal(quote.items[0].unitPriceInCents, 500); assert.equal(quote.clientId, client);
  assert.equal(await billing.outbox.count({ where: { type: 'billing.quote-issued.v1', payload: { path: ['sagaId'], equals: sagaId } } }), 1);
  process.stdout.write('OS → Billing: orçamento e deduplicação verificados em bancos locais separados; broker não exercitado.\n');
}
main().finally(async () => { await os.$disconnect(); await billing.$disconnect(); }).catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
