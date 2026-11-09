/* Teste local: Function real, HTTPS local e controller/runtime reais do OS. */
const { fork, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

async function osProcess() {
  require('reflect-metadata');
  const { Module } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const { trace } = require('@opentelemetry/api');
  const {
    Phase4InternalClientController,
    Phase4RegistryRuntime,
  } = require('../../dist/src/interfaces/controllers/fase4/CadastrosController');
  class TestModule {}
  Module({
    controllers: [Phase4InternalClientController],
    providers: [Phase4RegistryRuntime],
  })(TestModule);
  const app = await NestFactory.create(TestModule, {
    logger: false,
    abortOnError: false,
  });
  app.use((req, _res, next) => {
    const span = trace.getActiveSpan();
    process.send({
      kind: 'os-span',
      traceId: span?.spanContext().traceId,
      parentSpanId: span?.parentSpanContext?.spanId,
      spanId: span?.spanContext().spanId,
    });
    next();
  });
  await app.listen(0, '127.0.0.1');
  process.send({ kind: 'ready', url: await app.getUrl() });
  process.on('message', async (message) => {
    if (message === 'stop') {
      await app.close();
      process.exit(0);
    }
  });
}

async function authProcess() {
  const { authenticateHandler } = require(
    path.join(process.cwd(), 'dist/src/index.js'),
  );
  const jwt = require(path.join(process.cwd(), 'node_modules/jsonwebtoken'));
  const request = {
    headers: new Headers({
      traceparent: process.env.TEST_TRACEPARENT,
      tracestate: 'vendor=local',
    }),
    json: async () => ({ cpf: process.env.TEST_CPF }),
  };
  const response = await authenticateHandler(request, {});
  const claims = jwt.verify(
    response.jsonBody.accessToken,
    process.env.JWT_CLIENT_SECRET,
    { issuer: 'soat-auth-function', audience: 'soat-api' },
  );
  process.send(
    {
      kind: 'auth-result',
      status: response.status,
      subject: claims.sub,
      role: claims.role,
    },
    () => process.exit(0),
  );
}

async function main() {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const http = require('node:http');
  const https = require('node:https');
  const { PrismaClient } = require('@prisma/client');
  const authDir = process.env.AUTH_REPO_DIR;
  const database = process.env.OS_TEST_DATABASE_URL;
  if (!authDir || !path.isAbsolute(authDir) || !database)
    throw Error(
      'AUTH_REPO_DIR absoluto e OS_TEST_DATABASE_URL são obrigatórios',
    );
  const u = new URL(database);
  if (
    !['localhost', '127.0.0.1', '::1'].includes(u.hostname) ||
    !u.pathname.endsWith('_test')
  )
    throw Error('Banco local terminado em _test é obrigatório');
  const db = new PrismaClient({ datasources: { db: { url: database } } });
  const tag = randomUUID();
  const clientId = `trace-client-${tag}`;
  let digits = String(
    BigInt(`0x${tag.replaceAll('-', '').slice(0, 10)}`) % 1000000000n,
  ).padStart(9, '0');
  if (/^(\d)\1+$/.test(digits))
    digits = `${digits.slice(0, 8)}${digits[8] === '9' ? '0' : '9'}`;
  const digit = (value) => {
    const n =
      ([...value].reduce(
        (sum, x, i) => sum + Number(x) * (value.length + 1 - i),
        0,
      ) *
        10) %
      11;
    return String(n === 10 ? 0 : n);
  };
  digits += digit(digits);
  digits += digit(digits);
  const token = `local-integration-${randomUUID()}-secret`;
  const jwtSecret = `local-jwt-${randomUUID()}-secret`;
  const traceId = randomUUID().replaceAll('-', '');
  const parentSpanId = '1234567890abcdef';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soat-auth-trace-'));
  const cert = path.join(tmp, 'cert.pem');
  const key = path.join(tmp, 'key.pem');
  const children = [];
  let collector;
  let proxy;
  let osChild;
  const listen = (server) =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
  const awaitMessage = (child, kind) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error(`Tempo esgotado: ${kind}`)),
        30000,
      );
      child.on('message', (message) => {
        if (message?.kind === kind) {
          clearTimeout(timer);
          resolve(message);
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error(`Processo encerrou antes de ${kind}: ${code}`));
      });
    });
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout',
        key,
        '-out',
        cert,
      ],
      { stdio: 'ignore' },
    );
    collector = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200);
      res.end();
    });
    const collectorPort = await listen(collector);
    await db.$executeRaw`INSERT INTO "Cliente" ("id","nome","documento","tipo","contato","updatedAt") VALUES (${clientId},'Teste',${digits},'PF','test@example.test',NOW())`;
    const common = {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      OBSERVABILITY_ENABLED: 'true',
      NEW_RELIC_LICENSE_KEY: 'local-fixture-only',
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collectorPort}`,
      INTERNAL_CLIENT_LOOKUP_TOKEN: token,
      JWT_CLIENT_SECRET: jwtSecret,
    };
    const preload = path.join(
      process.cwd(),
      'scripts/integration/auth-os-trace-preload.cjs',
    );
    osChild = fork(__filename, ['os'], {
      cwd: process.cwd(),
      execArgv: [
        '--require',
        preload,
        '--require',
        path.join(
          process.cwd(),
          'dist/src/infrastructure/observability/instrumentation.js',
        ),
      ],
      env: {
        ...common,
        SAGA_DATABASE_URL: database,
        ENABLE_FASE4_REGISTRY: 'true',
        JWT_SECRET: 'local-admin-secret-with-at-least-32-bytes',
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    children.push(osChild);
    const observations = [];
    const spans = [];
    osChild.on('message', (message) => {
      if (message?.kind === 'os-span') observations.push(message);
      if (message?.kind === 'finished-span') spans.push(message);
    });
    const ready = await awaitMessage(osChild, 'ready');
    const target = new URL(ready.url);
    let forwarded;
    proxy = https.createServer(
      { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
      (req, res) => {
        forwarded = {
          path: req.url,
          traceparent: req.headers.traceparent,
          tracestate: req.headers.tracestate,
          authorized: req.headers.authorization === `Bearer ${token}`,
        };
        const upstream = http.request(
          {
            hostname: '127.0.0.1',
            port: target.port,
            method: req.method,
            path: req.url,
            headers: req.headers,
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
          },
        );
        upstream.on('error', () => {
          res.writeHead(502);
          res.end();
        });
        req.pipe(upstream);
      },
    );
    const proxyPort = await listen(proxy);
    const auth = fork(__filename, ['auth'], {
      cwd: authDir,
      execArgv: ['--require', preload],
      env: {
        ...common,
        OS_INTERNAL_BASE_URL: `https://127.0.0.1:${proxyPort}/fase4`,
        NODE_EXTRA_CA_CERTS: cert,
        TEST_CPF: digits,
        TEST_TRACEPARENT: `00-${traceId}-${parentSpanId}-01`,
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    children.push(auth);
    auth.on('message', (message) => {
      if (message?.kind === 'finished-span') spans.push(message);
    });
    const result = await awaitMessage(auth, 'auth-result');
    assert.equal(result.status, 200);
    assert.equal(result.subject, clientId);
    assert.equal(result.role, 'cliente');
    assert.equal(forwarded?.path, '/fase4/internal/clientes/validar-cpf');
    assert.equal(forwarded?.authorized, true);
    assert.equal(
      forwarded?.tracestate,
      'vendor=local',
      `tracestate inesperado: ${forwarded?.tracestate}; traceparent: ${forwarded?.traceparent}`,
    );
    const parts = forwarded.traceparent?.split('-');
    assert.equal(parts?.[1], traceId);
    assert.notEqual(parts?.[2], parentSpanId);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].traceId, traceId);
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      !spans.some((span) => span.spanId === observations[0].parentSpanId)
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    const byId = new Map(
      spans
        .filter((span) => span.traceId === traceId)
        .map((span) => [span.spanId, span]),
    );
    const client = byId.get(parts[2]);
    assert.equal(client?.name, 'consultar OS');
    const authSpan = byId.get(client.parentSpanId);
    assert.equal(authSpan?.name, '/auth/cpf');
    assert.equal(authSpan.parentSpanId, parentSpanId);
    let current = observations[0];
    const visited = new Set();
    while (
      current.parentSpanId !== parts[2] &&
      !visited.has(current.parentSpanId)
    ) {
      visited.add(current.parentSpanId);
      current = byId.get(current.parentSpanId);
      if (!current) break;
    }
    assert.ok(
      current && current.parentSpanId === parts[2],
      `Cadeia de spans incompleta: ${JSON.stringify({ observed: observations[0], spans: [...byId.values()] })}`,
    );
    process.stdout.write(
      'Function e OS reais: HTTPS local, bearer exclusivo e trace W3C confirmado.\n',
    );
  } finally {
    for (const child of children) if (child.connected) child.send('stop');
    for (const child of children)
      if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
    if (collector) await new Promise((resolve) => collector.close(resolve));
    await db.$executeRaw`DELETE FROM "Cliente" WHERE "id"=${clientId}`;
    await db.$disconnect();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const role = process.argv[2];
Promise.resolve(
  role === 'os' ? osProcess() : role === 'auth' ? authProcess() : main(),
).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
  if (process.send) process.disconnect();
});
