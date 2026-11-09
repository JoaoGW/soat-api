import {
  CorrelationIdMiddleware,
  RequestComCorrelacao,
} from './CorrelationIdMiddleware';

describe('CorrelationIdMiddleware', () => {
  const middleware = new CorrelationIdMiddleware();

  it('reutiliza a correlação recebida e a devolve na resposta', () => {
    const request = {
      header: jest.fn().mockReturnValue('correlacao-cliente'),
    } as unknown as RequestComCorrelacao;
    const response = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    middleware.use(request, response, next);

    expect(request.correlationId).toBe('correlacao-cliente');
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Correlation-ID',
      'correlacao-cliente',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('gera uma correlação quando o header está ausente ou é excessivo', () => {
    const request = {
      header: jest.fn().mockReturnValue('x'.repeat(129)),
    } as unknown as RequestComCorrelacao;
    const response = { setHeader: jest.fn() } as any;

    middleware.use(request, response, jest.fn());

    expect(request.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
