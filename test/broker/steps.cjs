const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Given, When, Then, setDefaultTimeout } = require('@cucumber/cucumber');

const run = promisify(execFile);
setDefaultTimeout(120000);

Given('que os serviços e seus bancos locais de teste estão configurados', function () {
  for (const name of ['OS_TEST_DATABASE_URL', 'BILLING_TEST_DATABASE_URL', 'BILLING_REPO_DIR', 'EXECUTION_REPO_DIR', 'COSMOS_TEST_ENDPOINT', 'SERVICE_BUS_TEST_CONNECTION_STRING']) {
    assert.ok(process.env[name], `${name} é obrigatória`);
  }
});

When('executo o cenário distribuído {string} pelo broker', async function (scenario) {
  const result = await run(process.execPath, [path.resolve('scripts/integration/broker-three-services.cjs'), '--scenario', scenario], {
    cwd: process.cwd(),
    env: process.env,
    timeout: 100000,
    maxBuffer: 1024 * 1024,
  });
  this.output = result.stdout;
  if (result.stderr) await this.attach(result.stderr, 'text/plain');
  await this.attach(result.stdout, 'text/plain');
});

Then('a execução confirma {string}', function (expected) {
  assert.ok(this.output?.includes(expected), `Evidência ausente: ${expected}`);
});
