/* Jornada local: três processos isolados, consumidores e outboxes reais, broker emulado. */
const { fork } = require('node:child_process');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PrismaClient: OsDb } = require('@prisma/client');
const billingDir = process.env.BILLING_REPO_DIR,
  execDir = process.env.EXECUTION_REPO_DIR;
const osUrl = process.env.OS_TEST_DATABASE_URL,
  billingUrl = process.env.BILLING_TEST_DATABASE_URL,
  connection = process.env.SERVICE_BUS_TEST_CONNECTION_STRING,
  cosmosEndpoint = process.env.COSMOS_TEST_ENDPOINT;
for (const value of [osUrl, billingUrl]) {
  if (!value) throw Error('Bancos locais obrigatórios');
  const u = new URL(value);
  if (
    !['localhost', '127.0.0.1', '::1'].includes(u.hostname) ||
    !u.pathname.endsWith('_test')
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
  throw Error('Bancos distintos e diretórios absolutos obrigatórios');
if (
  !connection ||
  !/^Endpoint=sb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(connection) ||
  !/UseDevelopmentEmulator=true/i.test(connection)
)
  throw Error('Broker emulador local obrigatório');
if (
  !['http://localhost:8081', 'http://127.0.0.1:8081'].includes(cosmosEndpoint)
)
  throw Error('Emulador Cosmos local obrigatório');
const { PrismaClient: BillingDb } = require(
  path.join(billingDir, 'node_modules/@prisma/client'),
);
const { CosmosClient } = require(
  path.join(execDir, 'node_modules/@azure/cosmos'),
);
const os = new OsDb({ datasources: { db: { url: osUrl } } }),
  billing = new BillingDb({ datasources: { db: { url: billingUrl } } }),
  cosmos = new CosmosClient({
    endpoint: cosmosEndpoint,
    key: Buffer.from('local-test-key').toString('base64'),
  });
const tag = randomUUID(),
  cosmosDatabase = `bdd_process_${tag.replaceAll('-', '')}`;
const keys = {};
for (const [role, producer] of Object.entries({
  os: 'soat-os-service',
  billing: 'soat-billing-service',
  execution: 'soat-execution-service',
})) {
  const k = generateKeyPairSync('ed25519');
  keys[role] = {
    producer,
    privateKey: k.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    publicKey: k.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}
const config = {
  billingDir,
  execDir,
  osUrl,
  billingUrl,
  connection,
  cosmosEndpoint,
  cosmosDatabase,
  keys,
  tag,
  providerOrder: `ORD${tag.replaceAll('-', '').slice(0, 26)}`,
  providerPayment: String(BigInt(`0x${tag.replaceAll('-', '').slice(0, 12)}`)),
};
const children = [];
let next = 0;
function child(role) {
  const env = { PATH: process.env.PATH, NODE_ENV: 'test' };
  const p = fork(path.join(__dirname, 'broker-process-worker.cjs'), [], {
    env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  children.push(p);
  p.pending = new Map();
  p.on('message', (m) => {
    const waiter = p.pending.get(m.id);
    if (!waiter) return;
    p.pending.delete(m.id);
    clearTimeout(waiter.timer);
    m.ok ? waiter.resolve(m) : waiter.reject(Error(m.error));
  });
  p.on('exit', (code) => {
    for (const waiter of p.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(Error(`${role} terminou com ${code}`));
    }
    p.pending.clear();
  });
  p.call = (method, data) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        p.pending.delete(id);
        reject(Error(`Tempo esgotado: ${role}.${method}`));
      }, 30000);
      p.pending.set(id, { resolve, reject, timer });
      const roleKeys = Object.fromEntries(
        Object.entries(keys).map(([name, key]) => [
          name,
          {
            producer: key.producer,
            publicKey: key.publicKey,
            ...(name === role ? { privateKey: key.privateKey } : {}),
          },
        ]),
      );
      const roleConfig = {
        ...config,
        keys: roleKeys,
        role,
        osUrl: role === 'os' ? osUrl : undefined,
        billingUrl: role === 'billing' ? billingUrl : undefined,
      };
      p.send({
        id,
        method,
        data,
        ...(method === 'init' ? { config: roleConfig } : {}),
      });
    });
  return p;
}
async function waitFor(label, fn) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(`Tempo esgotado: ${label}`);
}
async function main() {
  const database = (
    await cosmos.databases.createIfNotExists({ id: cosmosDatabase })
  ).database;
  await database.containers.createIfNotExists({
    id: 'operations',
    partitionKey: { paths: ['/filialId'] },
  });
  const container = database.container('operations');
  try {
    const o = child('os'),
      b = child('billing'),
      e = child('execution');
    const ready = await Promise.all([
      o.call('init'),
      b.call('init'),
      e.call('init'),
    ]);
    assert.equal(new Set(ready.map((x) => x.pid)).size, 3);
    await e.call('seed');
    const client = `client-${tag}`,
      vehicle = `vehicle-${tag}`,
      doc = String(
        BigInt('0x' + tag.replaceAll('-', '').slice(0, 10)) % 100000000000n,
      ).padStart(11, '0');
    await os.$executeRaw`INSERT INTO "Cliente" ("id","nome","documento","tipo","contato","updatedAt") VALUES (${client},'Teste',${doc},'PF','test@example.test',NOW())`;
    await os.$executeRaw`INSERT INTO "Veiculo" ("id","clienteId","placa","marca","modelo","ano","updatedAt") VALUES (${vehicle},${client},${tag.slice(0, 7)},'X','Y',2020,NOW())`;
    const opened = (
      await o.call('open', {
        actorId: 'admin',
        key: `key-${tag}`,
        clienteId: client,
        veiculoId: vehicle,
        filialId: 'branch',
      })
    ).result;
    const action = {
      osId: opened.id,
      sagaId: opened.sagaId,
      filialId: 'branch',
      correlationId: opened.sagaId,
    };
    await waitFor('diagnóstico criado', async () => {
      try {
        return (await container.item(`diagnosis:${opened.id}`, 'branch').read())
          .resource;
      } catch {
        return null;
      }
    });
    await e.call('diagnose', action);
    const quote = await waitFor('orçamento', () =>
      billing.quote.findFirst({ where: { osId: opened.id } }),
    );
    assert.equal(quote.totalInCents, 1000);
    await waitFor('orçamento recebido pelo OS', async () => {
      const x =
        await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
      return x[0]?.status === 'AGUARDANDO_APROVACAO';
    });
    await b.call('approve', {
      quoteId: quote.id,
      clientId: client,
      version: 1,
      decision: 'APPROVED',
      idempotencyKey: `approve-${tag}`,
      correlationId: opened.sagaId,
    });
    await waitFor('cobrança criada', () =>
      billing.charge.findFirst({
        where: { osId: opened.id, providerOrderId: config.providerOrder },
      }),
    );
    assert.equal((await b.call('pay')).result, 'APPLIED');
    await waitFor('trabalho na fila', async () => {
      const x =
        await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
      return x[0]?.status === 'NA_FILA';
    });
    await e.call('start', action);
    await waitFor('reparo iniciado', async () => {
      const x =
        await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
      return x[0]?.status === 'EM_EXECUCAO';
    });
    await e.call('complete', action);
    await waitFor('reparo concluído', async () => {
      const x =
        await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
      return x[0]?.status === 'CONCLUIDA';
    });
    assert.equal(
      (await o.call('deliver', { osId: opened.id })).result,
      'ENTREGUE',
    );
    const delivered =
      await os.$queryRaw`SELECT "status" FROM "OrdemDeServico" WHERE "id"=${opened.id}`;
    assert.equal(delivered[0].status, 'ENTREGUE');
    process.stdout.write(
      'Três processos independentes: diagnóstico, orçamento, pagamento simulado, reparo e entrega passaram pelo broker.\n',
    );
  } finally {
    await Promise.allSettled(
      children.filter((p) => p.connected).map((p) => p.call('stop')),
    );
    for (const p of children) if (p.connected) p.kill('SIGTERM');
    await database.delete();
  }
}
main()
  .finally(async () => {
    await os.$disconnect();
    await billing.$disconnect();
    cosmos.dispose();
  })
  .catch((e) => {
    console.error(e.stack || e);
    process.exitCode = 1;
  });
