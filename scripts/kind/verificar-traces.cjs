#!/usr/bin/env node
'use strict';
// Confere no Jaeger do ambiente kind que a telemetria dos três microsserviços
// chegou e que o contexto W3C atravessou a Saga: ao menos um trace precisa ter
// spans de TRACE_MIN_SERVICES serviços (padrão: OS, Billing e Execution).
const JAEGER = (process.env.JAEGER_URL || 'http://localhost:16686').replace(/\/$/, '');
const SERVICES = ['soat-api', 'soat-billing-service', 'soat-execution-service'];
const MIN = Number(process.env.TRACE_MIN_SERVICES || SERVICES.length);
const TIMEOUT_MS = Number(process.env.TRACE_TIMEOUT_MS || 120000);

async function get(path) {
  const response = await fetch(`${JAEGER}${path}`);
  if (!response.ok) throw new Error(`Jaeger respondeu ${response.status} em ${path}`);
  return (await response.json()).data ?? [];
}

async function collect() {
  const services = await get('/api/services');
  const traces = new Map();
  for (const service of SERVICES.filter((name) => services.includes(name))) {
    for (const trace of await get(`/api/traces?service=${service}&limit=200&lookback=2h`)) traces.set(trace.traceID, trace);
  }
  let best = { traceID: '', services: [], spans: 0 };
  for (const trace of traces.values()) {
    const names = [...new Set(Object.values(trace.processes ?? {}).map((process) => process.serviceName))].filter((name) => SERVICES.includes(name)).sort();
    if (names.length > best.services.length || (names.length === best.services.length && trace.spans.length > best.spans)) best = { traceID: trace.traceID, services: names, spans: trace.spans.length };
  }
  return { reporting: SERVICES.filter((name) => services.includes(name)), traces: traces.size, best };
}

async function main() {
  const deadline = Date.now() + TIMEOUT_MS;
  let result;
  // O Collector exporta em lotes; a espera cobre o atraso entre a jornada e o Jaeger.
  for (;;) {
    try { result = await collect(); } catch (error) { result = { error: error.message }; }
    if (!result.error && result.reporting.length === SERVICES.length && result.best.services.length >= MIN) break;
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (result.error) throw new Error(result.error);
  console.log(`Serviços com telemetria no Jaeger: ${result.reporting.join(', ') || 'nenhum'}`);
  console.log(`Traces analisados: ${result.traces}`);
  console.log(`Trace mais distribuído: ${result.best.traceID} com ${result.best.spans} spans em ${result.best.services.join(', ')}`);
  console.log(`Abrir no Jaeger: ${JAEGER}/trace/${result.best.traceID}`);
  const missing = SERVICES.filter((name) => !result.reporting.includes(name));
  if (missing.length) throw new Error(`Sem telemetria de: ${missing.join(', ')}`);
  if (result.best.services.length < MIN) throw new Error(`Nenhum trace atravessa ${MIN} serviços`);
  console.log(`Rastreamento distribuído confirmado: um único trace atravessa ${result.best.services.length} serviços.`);
}

main().catch((error) => {
  console.error(`Falha na verificação de traces: ${error.message}`);
  process.exit(1);
});
