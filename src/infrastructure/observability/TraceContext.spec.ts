import {
  context,
  propagation,
  ROOT_CONTEXT,
  trace,
  TraceFlags,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { captureTrace, forwardTrace } from './TraceContext';

it('captura apenas contexto W3C válido do span ativo', () => {
  const manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  try {
    const span = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      traceFlags: TraceFlags.SAMPLED,
    });
    expect(context.with(span, captureTrace)).toEqual({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    });
    expect(context.with(span, () => forwardTrace(null))).toEqual({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    });
    expect(captureTrace()).toEqual({});
  } finally {
    propagation.disable();
    context.disable();
    manager.disable();
  }
});

it('encaminha apenas contexto de trace limitado e sem controles', () => {
  const traceparent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  expect(forwardTrace({ traceparent, tracestate: 'vendor=state' })).toEqual({
    traceparent,
    tracestate: 'vendor=state',
  });
  expect(forwardTrace({ traceparent, tracestate: 'invalid\nvalue' })).toEqual({
    traceparent,
  });
  expect(forwardTrace({ traceparent: 'invalid' })).toEqual({});
  expect(forwardTrace(null)).toEqual({});
});
