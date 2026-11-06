import { context, propagation } from '@opentelemetry/api';

/** Persiste o contexto ativo na outbox sem dados HTTP ou pessoais. */
export function captureTrace(): { traceparent?: string; tracestate?: string } {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return {
    ...(typeof carrier.traceparent === 'string'
      ? { traceparent: carrier.traceparent }
      : {}),
    ...(typeof carrier.tracestate === 'string'
      ? { tracestate: carrier.tracestate }
      : {}),
  };
}

/** Conserva o contexto autenticado em eventos para o próximo comando durável. */
export function forwardTrace(value: unknown): {
  traceparent?: string;
  tracestate?: string;
} {
  const active = captureTrace();
  if (active.traceparent) return active;
  if (!value || typeof value !== 'object') return {};
  const event = value as { traceparent?: unknown; tracestate?: unknown };
  if (
    typeof event.traceparent !== 'string' ||
    !/^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/.test(
      event.traceparent,
    )
  )
    return {};
  return {
    traceparent: event.traceparent,
    ...(typeof event.tracestate === 'string' &&
    event.tracestate.length <= 512 &&
    /^[\x20-\x7e]*$/.test(event.tracestate)
      ? { tracestate: event.tracestate }
      : {}),
  };
}
