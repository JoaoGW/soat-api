import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OrcamentoWebhookTokenPayload,
  OrcamentoWebhookTokenPort,
} from '../../../application/ports/output/OrcamentoWebhookTokenPort';

@Injectable()
export class JwtOrcamentoWebhookTokenAdapter
  implements OrcamentoWebhookTokenPort
{
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async gerarToken(payload: OrcamentoWebhookTokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.config.getOrThrow<string>('WEBHOOK_SECRET'),
      expiresIn: (this.config.get<string>('WEBHOOK_TOKEN_EXPIRES_IN') ??
        '24h') as any,
    });
  }

  async validarToken(token: string): Promise<OrcamentoWebhookTokenPayload> {
    const payload = await this.jwtService.verifyAsync<
      Partial<OrcamentoWebhookTokenPayload>
    >(token, {
      secret: this.config.getOrThrow<string>('WEBHOOK_SECRET'),
    });

    if (
      typeof payload.osId !== 'string' ||
      (payload.acao !== 'aprovar' && payload.acao !== 'recusar')
    ) {
      throw new Error('Token de webhook invalido');
    }

    return {
      osId: payload.osId,
      acao: payload.acao,
    };
  }
}
