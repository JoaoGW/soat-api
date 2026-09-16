import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export type RequestComCorrelacao = Request & { correlationId: string };

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestComCorrelacao, res: Response, next: NextFunction): void {
    const received = req.header('x-correlation-id');
    req.correlationId =
      received && received.length <= 128 ? received : randomUUID();
    res.setHeader('X-Correlation-ID', req.correlationId);
    next();
  }
}
