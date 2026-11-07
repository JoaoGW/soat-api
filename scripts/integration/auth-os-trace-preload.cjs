/* Observa os spans reais dos SDKs sem modificar propagação ou exportação. */
const { createRequire } = require('node:module');
const path = require('node:path');
const localRequire = createRequire(path.join(process.cwd(), 'package.json'));
const { BatchSpanProcessor, SimpleSpanProcessor } = localRequire(
  '@opentelemetry/sdk-trace-base',
);
const sdkRequire = createRequire(
  localRequire.resolve('@opentelemetry/sdk-node/package.json'),
);
const nativeTrace = sdkRequire('@opentelemetry/sdk-trace');
for (const Processor of new Set([
  BatchSpanProcessor,
  SimpleSpanProcessor,
  nativeTrace.BatchSpanProcessor,
  nativeTrace.SimpleSpanProcessor,
])) {
  const original = Processor.prototype.onEnd;
  Processor.prototype.onEnd = function (span) {
    if (process.connected)
      process.send({
        kind: 'finished-span',
        name: span.name,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanContext?.spanId,
      });
    return original.call(this, span);
  };
}
