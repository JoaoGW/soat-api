/* Cobertura combinada sem excluir os adapters ou o código legado ainda ativo. */
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createCoverageMap } = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const legacy = process.env.FULL_LEGACY_TEST_DATABASE_URL;
const saga = process.env.FULL_SAGA_TEST_DATABASE_URL;
for (const value of [legacy, saga]) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Duas URLs de bancos locais de teste são obrigatórias'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '::1'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Somente bancos locais terminados em _test são permitidos');
}
if (legacy === saga) throw new Error('Bancos legado e Saga precisam ser distintos');
const jest = require.resolve('jest/bin/jest');
const base = ['--runInBand', '--watchman=false', '--coverage', '--coverageThreshold={}', '--collectCoverageFrom=src/**/*.ts', '--collectCoverageFrom=!src/**/*.spec.ts', '--collectCoverageFrom=!src/**/tests/**', '--coverageReporters=json'];
for (const [name, config, url] of [['unit', 'jest.config.ts', legacy], ['saga', 'jest.os.integration.cjs', saga], ['http', 'jest.e2e.config.ts', legacy]]) {
  const result = spawnSync(process.execPath, [jest, '--config', config, ...base, `--coverageDirectory=coverage/full/${name}`], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const coverage = createCoverageMap({});
for (const name of ['unit', 'saga', 'http']) coverage.merge(JSON.parse(readFileSync(path.join('coverage/full', name, 'coverage-final.json'), 'utf8')));
const summary = coverage.getCoverageSummary().toJSON();
const context = libReport.createContext({ dir: 'coverage/full/report', coverageMap: coverage });
for (const format of ['text-summary', 'json-summary', 'lcov']) reports.create(format).execute(context);
const failed = ['lines', 'statements', 'branches', 'functions'].filter(metric => summary[metric].pct < 80);
if (failed.length) { console.error(`Cobertura abaixo de 80%: ${failed.join(', ')}`); process.exitCode = 1; }
