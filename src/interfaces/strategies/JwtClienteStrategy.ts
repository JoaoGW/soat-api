import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

interface JwtClientePayload {
  sub: string;
  cpf: string;
  role: string;
}

export interface ClienteAutenticado {
  clienteId: string;
  cpf: string;
  role: 'cliente';
}

@Injectable()
export class JwtClienteStrategy extends PassportStrategy(
  Strategy,
  'jwt-client',
) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_CLIENT_SECRET'),
      issuer: configService.getOrThrow<string>('JWT_CLIENT_ISSUER'),
      audience: configService.getOrThrow<string>('JWT_CLIENT_AUDIENCE'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtClientePayload): Promise<ClienteAutenticado> {
    if (payload.role !== 'cliente' || !payload.sub || !payload.cpf) {
      throw new UnauthorizedException('Perfil sem permissao');
    }

    return {
      clienteId: payload.sub,
      cpf: payload.cpf,
      role: 'cliente',
    };
  }
}
