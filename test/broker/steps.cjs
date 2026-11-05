const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Given, When, Then, setDefaultTimeout } = require('@cucumber/cucumber');

const run = promisify(execFile);
setDefaultTimeout(120000);

async function runChecked(script, args, env) {
  try {
    return await run(process.execPath, [path.resolve(script), ...args], {
      cwd: process.cwd(), env, timeout: 100000, maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`Falha no cenário: ${error.message}\n${String(error.stderr || '').slice(-6000)}\n${String(error.stdout || '').slice(-3000)}`);
  }
}

Given('que os serviços e seus bancos locais de teste estão configurados', function () {
  for (const name of ['OS_TEST_DATABASE_URL', 'BILLING_TEST_DATABASE_URL', 'BILLING_REPO_DIR', 'EXECUTION_REPO_DIR', 'COSMOS_TEST_ENDPOINT', 'SERVICE_BUS_TEST_CONNECTION_STRING']) {
    assert.ok(process.env[name], `${name} é obrigatória`);
  }
});

When('executo o cenário distribuído {string} pelo broker', async function (scenario) {
  const result = await runChecked('scripts/integration/broker-three-services.cjs', ['--scenario', scenario], process.env);
  this.output = result.stdout;
  if (result.stderr) await this.attach(result.stderr, 'text/plain');
  await this.attach(result.stdout, 'text/plain');
});

When('executo a jornada com três processos independentes pelo broker', async function () {
  const result = await runChecked('scripts/integration/broker-independent-processes.cjs', [], process.env);
  this.output = result.stdout;
  if (result.stderr) await this.attach(result.stderr, 'text/plain');
  await this.attach(result.stdout, 'text/plain');
});

When('executo os workers Nest de produção em três processos pelo broker', async function () {
  const result = await runChecked('scripts/integration/broker-independent-processes.cjs', [], { ...process.env, SOAT_TEST_PRODUCTION_WORKERS: '1' });
  this.output = result.stdout;
  if (result.stderr) await this.attach(result.stderr, 'text/plain');
  await this.attach(result.stdout, 'text/plain');
});

When('executo a falha de estoque nos workers Nest pelo broker', async function () {
  const result = await runChecked('scripts/integration/broker-independent-processes.cjs', [], { ...process.env, SOAT_TEST_PRODUCTION_WORKERS: '1', SOAT_TEST_NO_STOCK: '1' });
  this.output = result.stdout;
  if (result.stderr) await this.attach(result.stderr, 'text/plain');
  await this.attach(result.stdout, 'text/plain');
});

When('executo a compensação após pagamento nos workers Nest pelo broker', async function () {
  const result = await runChecked('scripts/integration/broker-independent-processes.cjs', [], { ...process.env, SOAT_TEST_PRODUCTION_WORKERS: '1', SOAT_TEST_COMPENSATE: '1' });
  this.output = result.stdout;
  if (result.stderr) await this.attach(result.stderr, 'text/plain');
  await this.attach(result.stdout, 'text/plain');
});

When('reinicio o processo OS durante a Saga com workers Nest', async function () {
  const result = await runChecked('scripts/integration/broker-independent-processes.cjs', [], { ...process.env, SOAT_TEST_PRODUCTION_WORKERS: '1', SOAT_TEST_RESTART_OS: '1' });
  this.output = result.stdout;
  if (result.stderr) await this.attach(result.stderr, 'text/plain');
  await this.attach(result.stdout, 'text/plain');
});

Then('a execução confirma {string}', function (expected) {
  assert.ok(this.output?.includes(expected), `Evidência ausente: ${expected}`);
});
