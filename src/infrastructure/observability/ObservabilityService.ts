import { Injectable } from '@nestjs/common';
import { metrics, trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { observabilityResource } from './instrumentation';

type Attributes = Record<string, string | number | boolean | undefined>;

@Injectable()
export class ObservabilityService {
  private readonly meter = metrics.getMeter('soat-api');
  private readonly httpRequests = this.meter.createCounter(
    'soat.http.requisicoes',
  );
  private readonly httpErrors = this.meter.createCounter('soat.http.erros');
  private readonly httpDuration = this.meter.createHistogram(
    'soat.http.duracao',
    { unit: 'ms' },
  );
  private readonly ordersCreated = this.meter.createCounter(
    'soat.ordens_servico.criadas',
  );
  private readonly transitions = this.meter.createCounter(
    'soat.ordens_servico.transicoes',
  );
  private readonly stageDuration = this.meter.createHistogram(
    'soat.ordens_servico.tempo_etapa',
    { unit: 'min' },
  );
  private readonly orderErrors = this.meter.createCounter(
    'soat.ordens_servico.erros',
  );
  private readonly integrationErrors = this.meter.createCounter(
    'soat.integracoes.erros',
  );
  private readonly logger = logs.getLogger('soat-api');

  registrarHttp(
    route: string,
    method: string,
    status: number,
    duration: number,
    correlationId: string,
  ): void {
    const attributes = { route, method, 'http.response.status_code': status };
    this.httpRequests.add(1, attributes);
    this.httpDuration.record(duration, attributes);
    if (status >= 500) {
      this.httpErrors.add(1, attributes);
      if (
        route.startsWith('/ordens-servico') ||
        route.startsWith('/cliente/ordens-servico')
      )
        this.orderErrors.add(1, attributes);
    }
    this.log(status >= 500 ? 'error' : 'info', 'requisição concluída', {
      ...attributes,
      duration,
      correlationId,
    });
  }

  registrarOrdemCriada(): void {
    this.ordersCreated.add(1);
  }
  registrarTransicao(statusDestino: string): void {
    this.transitions.add(1, { status_destino: statusDestino });
  }
  registrarTempoEtapa(
    etapa: 'diagnostico' | 'execucao' | 'finalizacao',
    durationMs: number,
  ): void {
    this.stageDuration.record(durationMs / 60_000, { etapa });
  }
  registrarErroIntegracao(integracao: 'email' | 'postgres'): void {
    this.integrationErrors.add(1, { integracao });
    this.log('error', 'falha de integração', { integracao });
  }

  log(
    level: 'info' | 'error',
    message: string,
    attributes: Attributes = {},
  ): void {
    const span = trace.getActiveSpan()?.spanContext();
    const safeAttributes = Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value !== undefined),
    );
    const payload = {
      environment: observabilityResource.environment,
      service: observabilityResource.serviceName,
      version: observabilityResource.serviceVersion,
      ...safeAttributes,
      traceId: span?.traceId,
      spanId: span?.spanId,
    };
    const severityNumber =
      level === 'error' ? SeverityNumber.ERROR : SeverityNumber.INFO;
    this.logger.emit({
      severityNumber,
      severityText: level.toUpperCase(),
      body: message,
      attributes: payload,
    });
    console[level](
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...payload,
      }),
    );
  }
}
