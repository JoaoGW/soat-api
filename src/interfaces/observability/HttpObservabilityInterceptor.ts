import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { ObservabilityService } from '../../infrastructure/observability/ObservabilityService';
import { RequestComCorrelacao } from './CorrelationIdMiddleware';

@Injectable()
export class HttpObservabilityInterceptor implements NestInterceptor {
  constructor(private readonly observability: ObservabilityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestComCorrelacao>();
    const response = http.getResponse<{ statusCode: number }>();
    const start = performance.now();
    return next.handle().pipe(
      tap({
        next: () => this.registrar(request, response.statusCode, start),
        error: () => this.registrar(request, response.statusCode || 500, start),
      }),
    );
  }

  private registrar(
    request: RequestComCorrelacao,
    status: number,
    start: number,
  ): void {
    const route = request.route?.path
      ? `${request.baseUrl}${request.route.path}`
      : request.path;
    this.observability.registrarHttp(
      route,
      request.method,
      status,
      Math.round(performance.now() - start),
      request.correlationId,
    );
  }
}
