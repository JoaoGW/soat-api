import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

interface Input {
  username: string;
  password: string;
}

interface Output {
  accessToken: string;
}

// LoginUseCase e uma excecao justificada:
// depende de JwtService e ConfigService do NestJS.
// Em producao, abstrairia por interfaces TokenService e ConfigPort.
@Injectable()
export class LoginUseCase {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async execute(input: Input): Promise<Output> {
    const adminUsername =
      this.configService.getOrThrow<string>('ADMIN_USERNAME');
    const adminPasswordHash = this.configService.getOrThrow<string>(
      'ADMIN_PASSWORD_HASH',
    );

    const usernameValido = input.username === adminUsername;
    const senhaValida = await bcrypt.compare(input.password, adminPasswordHash);

    if (!usernameValido || !senhaValida) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: adminUsername,
      role: 'admin',
    });

    return { accessToken };
  }
}
