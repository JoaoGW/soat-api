// Exportador de spans do teste, sem rede ou credenciais de observabilidade.
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const exporter = {
  export(spans, done) {
    for (const span of spans) {
      if (process.connected) process.send({ traceSpan: {
        role: process.env.SOAT_TRACE_ROLE,
        name: span.name,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanContext?.spanId,
      } });
    }
    done({ code: 0 });
  },
  shutdown: async () => {},
};
global.soatTestTraceSdk = new NodeSDK({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
  instrumentations: [],
});
global.soatTestTraceSdk.start();
