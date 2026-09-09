import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginUseCase } from '../../auth/LoginUseCase';

describe('LoginUseCase', () => {
  it('deve retornar accessToken para login valido', async () => {
    const hash = await bcrypt.hash('Admin@123456', 10);
    const jwtService = new JwtService({ secret: 'jwt-secret-test-1234567890' });
    const configService = new ConfigService({
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: hash,
    });
    const useCase = new LoginUseCase(jwtService, configService);

    const output = await useCase.execute({
      username: 'admin',
      password: 'Admin@123456',
    });

    expect(output.accessToken).toBeDefined();
    expect(typeof output.accessToken).toBe('string');
  });

  it('deve falhar com username invalido', async () => {
    const hash = await bcrypt.hash('Admin@123456', 10);
    const jwtService = new JwtService({ secret: 'jwt-secret-test-1234567890' });
    const configService = new ConfigService({
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: hash,
    });
    const useCase = new LoginUseCase(jwtService, configService);

    await expect(
      useCase.execute({
        username: 'outro',
        password: 'Admin@123456',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deve falhar com senha invalida', async () => {
    const hash = await bcrypt.hash('Admin@123456', 10);
    const jwtService = new JwtService({ secret: 'jwt-secret-test-1234567890' });
    const configService = new ConfigService({
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: hash,
    });
    const useCase = new LoginUseCase(jwtService, configService);

    await expect(
      useCase.execute({
        username: 'admin',
        password: 'senha-errada',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
