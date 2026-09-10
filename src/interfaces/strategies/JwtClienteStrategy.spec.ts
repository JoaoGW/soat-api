import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtClienteStrategy } from './JwtClienteStrategy';

describe('JwtClienteStrategy', () => {
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_CLIENT_SECRET: 'test-client-secret-with-at-least-32-characters',
        JWT_CLIENT_ISSUER: 'soat-auth-function',
        JWT_CLIENT_AUDIENCE: 'soat-api',
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mapeia sub para clienteId quando o papel e cliente', async () => {
    const strategy = new JwtClienteStrategy(configService);

    await expect(
      strategy.validate({
        sub: 'cliente-1',
        cpf: '52998224725',
        role: 'cliente',
      }),
    ).resolves.toEqual({
      clienteId: 'cliente-1',
      cpf: '52998224725',
      role: 'cliente',
    });
  });

  it('rejeita token administrativo na estrategia de cliente', async () => {
    const strategy = new JwtClienteStrategy(configService);

    await expect(
      strategy.validate({
        sub: 'admin',
        cpf: '52998224725',
        role: 'admin',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
