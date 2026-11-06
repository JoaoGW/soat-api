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
  productionWorkers: process.env.SOAT_TEST_PRODUCTION_WORKERS === '1',
  noStock: process.env.SOAT_TEST_NO_STOCK === '1',
  compensateAfterPayment: process.env.SOAT_TEST_COMPENSATE === '1',
  badEvidence: process.env.SOAT_TEST_BAD_EVIDENCE === '1',
  restartOs: process.env.SOAT_TEST_RESTART_OS === '1',
  restartBilling: process.env.SOAT_TEST_RESTART_BILLING === '1',
  restartExecution: process.env.SOAT_TEST_RESTART_EXECUTION === '1',
  httpActions: process.env.SOAT_TEST_HTTP_ACTIONS === '1',
  traceTest: process.env.SOAT_TEST_TRACE === '1',
  openTrace: randomUUID().replaceAll('-', ''),
  diagnosisTrace: randomUUID().replaceAll('-', ''),
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
const spans = [];
let next = 0;
function child(role) {
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', ...(config.traceTest ? { SOAT_TRACE_ROLE: role } : {}) };
  const p = fork(path.join(__dirname, 'broker-process-worker.cjs'), [], {
    env,
    ...(config.traceTest ? { execArgv: ['--require', path.join(__dirname, 'trace-test-preload.cjs')] } : {}),
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  children.push(p);
  p.pending = new Map();
  p.on('message', (m) => {
    if (m.traceSpan) { spans.push(m.traceSpan); return; }
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
async function killAbruptly(processToStop) {
  await new Promise((resolve, reject) => {
    processToStop.once('exit', resolve);
    if (!processToStop.kill('SIGKILL')) reject(Error('Falha ao interromper processo'));
  });
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
    let o = child('os');
    let b = child('billing'),
      e = child('execution');
    const ready = await Promise.all([
      o.call('init'),
      b.call('init'),
      e.call('init'),
    ]);
    assert.equal(new Set(ready.map((x) => x.pid)).size, 3);
    await e.call('seed');
    let executionPid;
    if (config.restartExecution) {
      executionPid = e.pid;
      await killAbruptly(e);
    }
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
    if (config.restartExecution) {
      await waitFor('diagnóstico publicado durante indisponibilidade de Execution', async () => {
        const rows = await os.$queryRaw`SELECT "status" FROM "Outbox" WHERE "type"='execution.request-diagnosis.v1' AND "payload"->>'sagaId'=${opened.sagaId}`;
        return rows[0]?.status === 'SENT';
      });
      e = child('execution');
      assert.notEqual((await e.call('init')).pid, executionPid);
    }
    await waitFor('diagnóstico criado', async () => {
      try {
        return (await container.item(`diagnosis:${opened.id}`, 'branch').read())
          .resource;
      } catch {
        return null;
      }
    });
    let billingPid;
    if (config.restartBilling) {
      billingPid = b.pid;
      await killAbruptly(b);
    }
    await e.call('diagnose', action);
    if (config.restartBilling) {
      await waitFor('orçamento publicado durante indisponibilidade de Billing', async () => {
        const rows = await os.$queryRaw`SELECT "status" FROM "Outbox" WHERE "type"='billing.generate-quote.v1' AND "payload"->>'sagaId'=${opened.sagaId}`;
        return rows[0]?.status === 'SENT';
      });
      assert.equal(await billing.quote.count({ where: { osId: opened.id } }), 0);
      b = child('billing');
      assert.notEqual((await b.call('init')).pid, billingPid);
    }
    const quote = await waitFor('orçamento', () =>
      billing.quote.findFirst({ where: { osId: opened.id } }),
    );
    assert.equal(quote.totalInCents, 1000);
    await waitFor('orçamento recebido pelo OS', async () => {
      const x =
        await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
      return x[0]?.status === 'AGUARDANDO_APROVACAO';
    });
    const oldPid = o.pid;
    if (config.restartOs) await killAbruptly(o);
    await b.call('approve', {
      quoteId: quote.id,
      clientId: client,
      version: 1,
      decision: 'APPROVED',
      idempotencyKey: `approve-${tag}`,
      correlationId: opened.sagaId,
    });
    if (config.restartOs) {
      await waitFor('aprovação publicada durante indisponibilidade', async () => {
        const rows = await billing.$queryRaw`SELECT "status" FROM "Outbox" WHERE "type"='billing.quote-approved.v1' AND "payload"->>'sagaId'=${opened.sagaId}`;
        return rows[0]?.status === 'SENT';
      });
      o = child('os');
      const restarted = await o.call('init');
      assert.notEqual(restarted.pid, oldPid);
    }
    if (config.noStock) {
      await waitFor('compensação por estoque insuficiente', async () => {
        const rows = await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
        return rows[0]?.status === 'COMPENSADA';
      });
      const order = await os.$queryRaw`SELECT "status" FROM "OrdemDeServico" WHERE "id"=${opened.id}`;
      assert.equal(order[0].status, 'CANCELADA');
      assert.equal(await billing.charge.count({ where: { osId: opened.id } }), 0);
      process.stdout.write('Estoque insuficiente: workers compensaram pelo broker sem criar cobrança.\n');
      return;
    }
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
    if (config.compensateAfterPayment) {
      assert.equal((await o.call('compensate', { sagaId: opened.sagaId })).result, 'STARTED');
      if (config.badEvidence) {
        const staged = await waitFor('comando e evidência persistidos em Billing', async () => {
          const rows = await billing.$queryRaw`SELECT s."messageId", s."payload"->'data'->>'cancelEventId' AS "eventId" FROM "Inbox" s JOIN "Inbox" e ON e."consumer"='billing.compensation-evidence' AND e."messageId"=s."payload"->'data'->>'cancelEventId' WHERE s."consumer"='billing.refund-staging' AND s."payload"->>'sagaId'=${opened.sagaId} AND s."status"='PENDING' AND e."status"='APPLIED'`;
          return rows[0];
        });
        // Simula corrupção somente no banco descartável, depois da verificação
        // da assinatura e antes da avaliação da evidência pelo worker.
        await billing.$executeRaw`UPDATE "Inbox" SET "payload"=jsonb_set("payload", '{data,outcome}', '"ALREADY_STARTED"'::jsonb) WHERE "consumer"='billing.compensation-evidence' AND "messageId"=${staged.eventId}`;
        await b.call('resumeRefund');
        await waitFor('Saga em reconciliação pelo evento autenticado de Billing', async () => {
          const rows = await os.$queryRaw`SELECT "status", "lastError" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
          return rows[0]?.status === 'RECONCILIACAO_NECESSARIA' && rows[0]?.lastError === 'REFUND_EVIDENCE_MISMATCH';
        });
        const sent = await billing.$queryRaw`SELECT "status" FROM "Outbox" WHERE "type"='billing.refund-blocked.v1' AND "payload"->>'sagaId'=${opened.sagaId}`;
        const received = await os.$queryRaw`SELECT "status" FROM "Inbox" WHERE "consumer"='os.saga-events' AND "type"='billing.refund-blocked.v1' AND "payload"->>'sagaId'=${opened.sagaId}`;
        assert.equal(sent[0]?.status, 'SENT'); assert.equal(received[0]?.status, 'APPLIED');
        assert.equal(await billing.refund.count({ where: { payment: { charge: { osId: opened.id } } } }), 0);
        assert.equal((await b.call('refundCalls')).result, 0);
        const stock = (await container.item('stock:p1', 'branch').read()).resource;
        assert.equal(stock.reserved, 2); assert.equal(stock.balance, 5);
        process.stdout.write('Evidência divergente: Saga em reconciliação pelo broker sem reembolso ou liberação.\n');
        return;
      }
      await waitFor('reembolso e compensação', async () => {
        const rows = await os.$queryRaw`SELECT "status" FROM "SagaInstance" WHERE "id"=${opened.sagaId}`;
        return rows[0]?.status === 'COMPENSADA';
      });
      const refunds = await billing.refund.findMany({ where: { payment: { charge: { osId: opened.id } } } });
      assert.equal(refunds.length, 1);
      assert.equal(refunds[0].status, 'REFUNDED');
      const stock = (await container.item('stock:p1', 'branch').read()).resource;
      assert.equal(stock.reserved, 0);
      assert.equal(stock.balance, 5);
      process.stdout.write('Workers Nest: reembolso simulado confirmado e reserva liberada pelo broker.\n');
      return;
    }
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
    if (config.productionWorkers) process.stdout.write('Workers Nest de produção iniciados nos três processos.\n');
    if (config.httpActions) process.stdout.write('Jornada realizada pelas APIs HTTP autenticadas dos três serviços.\n');
    if (config.traceTest) {
      // O diagnóstico conserva o contexto do comando de abertura persistido,
      // mesmo quando a ação humana chega com outro trace HTTP.
      for (const [role, traceId] of [['execution', config.openTrace], ['billing', config.openTrace], ['os', config.openTrace]]) {
        const span = await waitFor(`trace ${role}`, () => spans.find(s => s.role === role && s.traceId === traceId && s.name === 'processar mensagem' && s.parentSpanId));
        await waitFor(`span pai de ${role}`, () => spans.find(s => s.traceId === traceId && s.spanId === span.parentSpanId));
      }
      process.stdout.write('Contexto W3C propagado pelo broker entre os três serviços.\n');
    }
    if (config.restartOs) process.stdout.write('Saga retomada após interrupção abrupta do processo OS.\n');
    if (config.restartBilling) process.stdout.write('Jornada retomada após interrupção abrupta do Billing.\n');
    if (config.restartExecution) process.stdout.write('Jornada retomada após interrupção abrupta do Execution.\n');
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
