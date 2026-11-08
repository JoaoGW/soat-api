/*
 * Jornada completa da OS contra os serviços implantados, somente pelas APIs
 * HTTP públicas: cadastro, abertura, diagnóstico, orçamento, aprovação do
 * cliente, cobrança, pagamento, fila, reparo e entrega. CENARIO=compensacao
 * força a falha após o pagamento e acompanha a compensação da Saga.
 */
const { createHmac, randomUUID, randomInt } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} é obrigatória`);
  return value;
};
const OS = env('OS_URL');
const BILLING = env('BILLING_URL');
const EXECUTION = env('EXECUTION_URL');
const SIMULATOR = process.env.MP_SIMULADO_URL || '';
const SCENARIO = process.env.CENARIO || 'feliz';
const BRANCH = process.env.FILIAL_ID || 'filial-kind';
const TIMEOUT = Number(process.env.JORNADA_TIMEOUT_MS || (SIMULATOR ? 180000 : 900000));

const step = (text) => process.stdout.write(`\n[${new Date().toISOString().slice(11, 19)}] ${text}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, url, { token, body, key, expected = [200, 201] } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!expected.includes(response.status)) throw new Error(`${method} ${url} respondeu ${response.status}: ${text.slice(0, 300)}`);
  return data;
}

async function waitFor(label, check) {
  const end = Date.now() + TIMEOUT;
  let last;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(1500);
  }
  throw new Error(`Tempo esgotado aguardando ${label}${last ? `: ${last.message}` : ''}`);
}

// Token de cliente equivalente ao emitido pela Auth Function após validar o CPF.
function clientToken(clienteId) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ sub: clienteId, role: 'cliente', iss: 'soat-auth-function', aud: 'soat-api', iat: now, exp: now + 3600 });
  const signature = createHmac('sha256', env('JWT_CLIENT_SECRET')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function cpf() {
  const digits = Array.from({ length: 9 }, () => randomInt(10));
  for (const size of [9, 10]) {
    const sum = digits.slice(0, size).reduce((total, digit, index) => total + digit * (size + 1 - index), 0);
    digits.push(((sum * 10) % 11) % 10);
  }
  return digits.join('');
}

function plate() {
  const letter = () => String.fromCharCode(65 + randomInt(26));
  return `${letter()}${letter()}${letter()}${randomInt(10)}${letter()}${randomInt(10)}${randomInt(10)}`;
}

async function sagaStatus(token, osId) {
  return (await call('GET', `${OS}/fase4/ordens-servico/${osId}/saga`, { token })).status;
}

async function waitSaga(token, osId, expected) {
  const statuses = [].concat(expected);
  const status = await waitFor(`Saga em ${statuses.join(' ou ')}`, async () => {
    const current = await sagaStatus(token, osId);
    return statuses.includes(current) ? current : null;
  });
  step(`Saga: ${status}`);
  return status;
}

async function main() {
  step(`Cenário "${SCENARIO}" com Mercado Pago ${SIMULATOR ? 'simulado' : 'de teste'}`);
  const { accessToken: admin } = await call('POST', `${OS}/auth/login`, { body: { username: env('ADMIN_USERNAME'), password: env('ADMIN_PASSWORD') } });

  step('Execution: catálogo e estoque da filial');
  await call('PUT', `${EXECUTION}/catalogo/${BRANCH}/PART/pastilha-freio`, { token: admin, body: { name: 'Pastilha de freio', unitPriceInCents: 500, active: true } });
  const stock = await call('GET', `${EXECUTION}/estoque/${BRANCH}/pastilha-freio`, { token: admin, expected: [200, 404] });
  await call('PUT', `${EXECUTION}/estoque/${BRANCH}/pastilha-freio`, { token: admin, key: randomUUID(), body: { balance: (stock?.reserved ?? 0) + 10, reason: 'INVENTORY' } });

  step('OS: cadastro de cliente e veículo');
  const client = await call('POST', `${OS}/fase4/clientes`, { token: admin, body: { nome: 'Cliente Demonstração', documento: cpf(), contato: 'cliente@exemplo.com' } });
  const vehicle = await call('POST', `${OS}/fase4/veiculos`, { token: admin, body: { clienteId: client.id, placa: plate(), marca: 'Fiat', modelo: 'Argo', ano: 2022 } });

  step('OS: abertura da ordem de serviço e início da Saga');
  const order = await call('POST', `${OS}/fase4/ordens-servico`, { token: admin, key: randomUUID(), body: { clienteId: client.id, veiculoId: vehicle.id, filialId: BRANCH, solicitacoes: ['Ruído ao frear'] } });
  process.stdout.write(`OS ${order.id} | Saga ${order.sagaId} | acompanhamento ${order.codigoAcompanhamento}\n`);
  const action = { sagaId: order.sagaId, filialId: BRANCH, correlationId: order.sagaId };

  step('Execution: diagnóstico recebido pelo broker e executado pela equipe');
  await waitFor('pedido de diagnóstico no Execution', () => call('POST', `${EXECUTION}/execucoes/${order.id}/iniciar-diagnostico`, { token: admin, key: `diag-start-${order.id}`, body: action }));
  await call('POST', `${EXECUTION}/execucoes/${order.id}/concluir-diagnostico`, { token: admin, key: `diag-end-${order.id}`, body: { ...action, items: [{ sourceId: 'pastilha-freio', itemType: 'PART', quantity: 2 }] } });

  step('Billing: orçamento gerado e enviado ao cliente');
  await waitSaga(admin, order.id, 'AGUARDANDO_APROVACAO');
  const detail = await call('GET', `${OS}/fase4/ordens-servico/${order.id}`, { token: admin });
  const customer = clientToken(client.id);
  const quote = await call('GET', `${BILLING}/orcamentos/${detail.quoteId}`, { token: customer });
  process.stdout.write(`Orçamento ${detail.quoteId} versão ${detail.quoteVersion}: ${JSON.stringify(quote)}\n`);

  step('Cliente: aprovação do orçamento no Billing');
  await call('POST', `${BILLING}/orcamentos/${detail.quoteId}/aprovar`, { token: customer, key: randomUUID(), body: { versao: detail.quoteVersion } });

  step('Execution reserva peças e Billing cria a cobrança no Mercado Pago');
  await waitSaga(admin, order.id, 'AGUARDANDO_PAGAMENTO');
  const charge = await waitFor('cobrança com QR', () => call('GET', `${BILLING}/cobrancas/por-os/${order.id}`, { token: customer }));
  process.stdout.write(`Cobrança: ${JSON.stringify(charge)}\n`);

  if (SIMULATOR) {
    step('Comprador paga o QR (simulador) e o webhook assinado chega ao Billing');
    const [providerOrder] = await call('GET', `${SIMULATOR}/simulador/ordens`);
    const paid = await call('POST', `${SIMULATOR}/simulador/pagamentos/${providerOrder.id}`);
    if (paid.webhook !== 200) throw new Error(`Webhook recusado pelo Billing: ${paid.webhook}`);
  } else {
    // O QR dinâmico é exibido no terminal quando o qrencode está instalado.
    const qr = spawnSync('qrencode', ['-t', 'ansiutf8', charge.qrData ?? ''], { encoding: 'utf8' });
    if (qr.status === 0) process.stdout.write(qr.stdout);
    step('Pague o QR com o comprador de teste no app do Mercado Pago; aguardando o webhook');
  }
  await waitSaga(admin, order.id, 'NA_FILA');

  if (SCENARIO === 'compensacao') {
    step('Falha simulada após o pagamento: compensação conduzida pelo OS');
    await call('POST', `${OS}/fase4/ordens-servico/${order.sagaId}/compensar`, { token: admin, body: { reason: 'STEP_FAILED' } });
    await waitSaga(admin, order.id, ['COMPENSADA', 'RECONCILIACAO_NECESSARIA']);
    const released = await call('GET', `${EXECUTION}/estoque/${BRANCH}/pastilha-freio`, { token: admin });
    process.stdout.write(`Estoque após compensação: ${JSON.stringify(released)}\n`);
    const saga = await call('GET', `${OS}/fase4/ordens-servico/${order.id}/saga`, { token: admin });
    process.stdout.write(`Operações da Saga: ${saga.operations.map((item) => `${item.step}=${item.status}`).join(', ')}\n`);
    if (saga.status !== 'COMPENSADA') throw new Error(`Saga terminou em ${saga.status}`);
    step('Compensação concluída: reembolso confirmado e peças liberadas');
    return;
  }

  step('Execution: início e conclusão do reparo');
  const queued = await waitFor('trabalho na fila', async () => (await call('GET', `${OS}/fase4/ordens-servico/${order.id}`, { token: admin })).executionId);
  const repair = { ...action, executionId: queued };
  await call('POST', `${EXECUTION}/execucoes/${order.id}/iniciar`, { token: admin, key: `work-start-${order.id}`, body: repair });
  await waitSaga(admin, order.id, 'EM_EXECUCAO');
  await call('POST', `${EXECUTION}/execucoes/${order.id}/finalizar`, { token: admin, key: `work-end-${order.id}`, body: repair });
  await waitSaga(admin, order.id, 'CONCLUIDA');

  step('OS: entrega do veículo');
  await call('POST', `${OS}/fase4/ordens-servico/${order.id}/entregar`, { token: admin });
  const history = await call('GET', `${OS}/fase4/ordens-servico/${order.id}/historico`, { token: admin });
  process.stdout.write(`Histórico: ${history.map((item) => item.status).join(' -> ')}\n`);
  step('Jornada concluída de ponta a ponta');
}

main().catch((error) => {
  console.error(`\nFalha na jornada: ${error.message}`);
  process.exit(1);
});
