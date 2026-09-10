import { logs } from '@opentelemetry/api-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

const enabled = process.env.OBSERVABILITY_ENABLED === 'true';
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'soat-api';
const serviceVersion = process.env.OTEL_SERVICE_VERSION ?? 'local';
const environment = process.env.NODE_ENV ?? 'development';

if (enabled) {
  const licenseKey = process.env.NEW_RELIC_LICENSE_KEY;
  if (!licenseKey)
    throw new Error(
      'NEW_RELIC_LICENSE_KEY é obrigatória quando OBSERVABILITY_ENABLED=true',
    );

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'https://otlp.nr-data.net:4318';
  const headers = { 'api-key': licenseKey };
  const resource = resourceFromAttributes({
    'service.name': serviceName,
    'service.version': serviceVersion,
    'deployment.environment.name': environment,
  });
  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
        headers,
      }),
      exportIntervalMillis: 30_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-pg': {
          enhancedDatabaseReporting: false,
          requestHook: (span) =>
            span.setAttribute('db.query.text', '[redacted]'),
        },
        '@opentelemetry/instrumentation-http': {
          requestHook: (span) => {
            span.setAttribute('url.full', '[redacted]');
            span.setAttribute('url.query', '[redacted]');
            span.setAttribute('http.target', '[redacted]');
          },
        },
      }),
    ],
  });
  sdk.start();

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs`, headers }),
      }),
    ],
  });
  logs.setGlobalLoggerProvider(loggerProvider);
}

export const observabilityResource = {
  environment,
  serviceName,
  serviceVersion,
};
