/* Exercita o próprio shell do workflow sem chamar GitHub ou fazer deploy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workflow = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const start = workflow.indexOf('      - name: Validar CI e ponta atual da branch');
const run = workflow.indexOf('        run: |\n', start);
const end = workflow.indexOf('\n  build_and_publish:', run);
assert.ok(start >= 0 && run > start && end > run, 'Gate não encontrado');
const shell = workflow.slice(run + '        run: |\n'.length, end).split('\n').map(line => {
  assert.ok(line.startsWith('          ') || line === '', 'Indentação inesperada no gate');
  return line.slice(10);
}).join('\n');
assert.match(workflow, /needs: authorize/);
assert.equal((workflow.match(/needs: \[authorize, build_and_publish\]/g) || []).length, 2);
assert.doesNotMatch(workflow, /\$\{\{\s*github\.sha\s*\}\}/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'soat-deploy-gate-'));
const sha = 'a'.repeat(40); const repo = 'example/soat-api'; const branch = 'development';
const runs = [{ head_sha: sha, head_branch: branch, event: 'push', conclusion: 'success', head_repository: { full_name: repo } }];
try {
  const gh = path.join(temp, 'gh');
  fs.writeFileSync(gh, '#!/bin/sh\ncase "$*" in *git/ref/heads/*) printf "%s\\n" "$MOCK_HEAD" ;; *) printf "%s\\n" "$MOCK_RUNS" ;; esac\n', { mode: 0o700 });
  const base = { ...process.env, PATH: `${temp}${path.delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: repo, GITHUB_EVENT_NAME: 'workflow_run', RUN_SHA: sha, RUN_BRANCH: branch, RUN_EVENT: 'push', RUN_REPOSITORY: repo, RUN_CONCLUSION: 'success', MANUAL_SHA: '', MANUAL_BRANCH: '', MOCK_HEAD: sha, MOCK_RUNS: JSON.stringify({ workflow_runs: runs }), GITHUB_OUTPUT: path.join(temp, 'output') };
  const execute = overrides => { fs.writeFileSync(base.GITHUB_OUTPUT, ''); return spawnSync('bash', ['-c', shell], { encoding: 'utf8', env: { ...base, ...overrides } }); };
  let result = execute({}); assert.equal(result.status, 0, result.stderr); assert.equal(fs.readFileSync(base.GITHUB_OUTPUT, 'utf8'), `sha=${sha}\nbranch=${branch}\n`);
  result = execute({ GITHUB_EVENT_NAME: 'workflow_dispatch', MANUAL_SHA: sha, MANUAL_BRANCH: branch }); assert.equal(result.status, 0, result.stderr);
  for (const overrides of [
    { RUN_CONCLUSION: 'failure' }, { RUN_EVENT: 'pull_request' }, { RUN_REPOSITORY: 'fork/repo' },
    { RUN_BRANCH: 'feature' }, { RUN_SHA: 'invalid' }, { MOCK_HEAD: 'b'.repeat(40) },
    { MOCK_RUNS: JSON.stringify({ workflow_runs: [] }) },
    { MOCK_RUNS: JSON.stringify({ workflow_runs: [{ ...runs[0], conclusion: 'failure' }] }) },
    { MOCK_RUNS: JSON.stringify({ workflow_runs: [{ ...runs[0], event: 'pull_request' }] }) },
    { MOCK_RUNS: JSON.stringify({ workflow_runs: [{ ...runs[0], head_repository: { full_name: 'fork/repo' } }] }) },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', MANUAL_SHA: '$(echo injected)', MANUAL_BRANCH: branch },
  ]) assert.notEqual(execute(overrides).status, 0, `Gate aceitou ${JSON.stringify(overrides)}`);
  const deployEnv = { ...process.env, KEY_VAULT_NAME: 'test', AZURE_TENANT_ID: 'test', API_WORKLOAD_CLIENT_ID: 'test', APP_VERSION: sha };
  for (const image of [`ghcr.io/joaogw/soat-api:${sha}`, 'ghcr.io/joaogw/soat-api:latest', `example/soat-api:${sha}`]) {
    const deploy = spawnSync('bash', ['scripts/deploy-api.sh', 'application', 'hml', image], { encoding: 'utf8', env: deployEnv });
    assert.notEqual(deploy.status, 0, `Deploy aceitou imagem ou checkout não autorizado: ${image}`);
    assert.match(deploy.stderr, /SHA aprovado/);
  }
  console.log('Gate rejeita SHA, CI, branch ou repositório não autorizados.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
