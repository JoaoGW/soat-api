import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtOrcamentoWebhookTokenAdapter } from './JwtOrcamentoWebhookTokenAdapter';

describe('JwtOrcamentoWebhookTokenAdapter', () => {
  function makeAdapter(expiresIn = '1h') {
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'WEBHOOK_SECRET') {
          return 'test-webhook-secret-with-at-least-32-characters';
        }
        throw new Error(`Config nao encontrada: ${key}`);
      }),
      get: jest.fn((key: string) => {
        if (key === 'WEBHOOK_TOKEN_EXPIRES_IN') return expiresIn;
        return undefined;
      }),
    } as unknown as ConfigService;

    return new JwtOrcamentoWebhookTokenAdapter(new JwtService(), config);
  }

  it('deve gerar e validar token de webhook', async () => {
    const adapter = makeAdapter();

    const token = await adapter.gerarToken({ osId: 'os-1', acao: 'aprovar' });
    const payload = await adapter.validarToken(token);

    expect(payload).toEqual({ osId: 'os-1', acao: 'aprovar' });
  });

  it('deve gerar tokens diferentes para aprovacao e recusa', async () => {
    const adapter = makeAdapter();

    const tokenAprovacao = await adapter.gerarToken({
      osId: 'os-1',
      acao: 'aprovar',
    });
    const tokenRecusa = await adapter.gerarToken({
      osId: 'os-1',
      acao: 'recusar',
    });

    expect(tokenAprovacao).not.toBe(tokenRecusa);
  });

  it('deve validar token de recusa e retornar payload correto', async () => {
    const adapter = makeAdapter();

    const token = await adapter.gerarToken({ osId: 'os-1', acao: 'recusar' });
    const payload = await adapter.validarToken(token);

    expect(payload).toEqual({ osId: 'os-1', acao: 'recusar' });
  });

  it('deve rejeitar token expirado', async () => {
    const adapter = makeAdapter(-10 as any);

    const token = await adapter.gerarToken({ osId: 'os-1', acao: 'recusar' });

    await expect(adapter.validarToken(token)).rejects.toThrow();
  });

  it('deve rejeitar token invalido', async () => {
    const adapter = makeAdapter();

    await expect(adapter.validarToken('token-invalido')).rejects.toThrow();
  });

  it('deve rejeitar payload malformado', async () => {
    const adapter = makeAdapter();
    const jwtService = new JwtService();
    const token = await jwtService.signAsync(
      { acao: 'aprovar' },
      { secret: 'test-webhook-secret-with-at-least-32-characters' },
    );

    await expect(adapter.validarToken(token)).rejects.toThrow(
      'Token de webhook invalido',
    );
  });

  it('deve rejeitar token assinado com secret diferente', async () => {
    const adapter = makeAdapter();
    const jwtService = new JwtService();
    const token = await jwtService.signAsync(
      { osId: 'os-1', acao: 'aprovar' },
      { secret: 'outro-segredo-com-mais-de-32-caracteres' },
    );

    await expect(adapter.validarToken(token)).rejects.toThrow();
  });
});
