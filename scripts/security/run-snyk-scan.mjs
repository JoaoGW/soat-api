import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const reportsDir = resolve(process.cwd(), 'reports', 'security');
const snykTxtPath = resolve(reportsDir, 'snyk-report.txt');
const snykJsonPath = resolve(reportsDir, 'snyk-report.json');

mkdirSync(reportsDir, { recursive: true });

function loadTokenFromEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return undefined;

  const envText = readFileSync(envPath, 'utf8');
  const envLines = envText.split(/\r?\n/);

  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (key !== 'SNYK_TOKEN') continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    return value || undefined;
  }

  return undefined;
}

const token = process.env.SNYK_TOKEN || loadTokenFromEnvFile();

if (!token) {
  console.error('SNYK_TOKEN nao definido. Configure no ambiente ou no arquivo .env e execute novamente.');
  process.exit(2);
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
}

const authResult = run('npx', ['--yes', 'snyk', 'auth', token]);
const authOutput = `${authResult.stdout ?? ''}${authResult.stderr ?? ''}`;

if ((authResult.status ?? 1) !== 0) {
  writeFileSync(snykTxtPath, authOutput, 'utf8');
  console.error('Falha na autenticacao do Snyk. Consulte reports/security/snyk-report.txt.');
  process.exit(authResult.status ?? 1);
}

const testArgs = [
  '--yes',
  'snyk',
  'test',
  '--all-projects',
  '--detection-depth=4',
  '--severity-threshold=low',
  `--json-file-output=${snykJsonPath}`,
];

const testResult = run('npx', testArgs);
const testOutput = `${testResult.stdout ?? ''}${testResult.stderr ?? ''}`;
writeFileSync(snykTxtPath, testOutput, 'utf8');

const exitCode = testResult.status ?? 2;

if (exitCode === 0) {
  console.log('Scan Snyk concluido sem vulnerabilidades.');
  process.exit(0);
}

if (exitCode === 1) {
  console.log('Scan Snyk concluido com vulnerabilidades encontradas.');
  process.exit(1);
}

console.error('Falha ao executar o scan Snyk. Consulte reports/security/snyk-report.txt.');
process.exit(exitCode);
