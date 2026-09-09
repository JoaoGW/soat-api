import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AprovarOrcamentoUseCase } from '../../../application/use-cases/AprovarOrcamentoUseCase';
import { RecusarOrcamentoUseCase } from '../../../application/use-cases/RecusarOrcamentoUseCase';
import type {
  OrcamentoWebhookTokenPayload,
  OrcamentoWebhookTokenPort,
} from '../../../application/ports/output/OrcamentoWebhookTokenPort';
import { ORCAMENTO_WEBHOOK_TOKEN_PORT } from '../../../application/ports/output/PortTokens';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookOrcamentoController {
  constructor(
    private readonly aprovarOrcamento: AprovarOrcamentoUseCase,
    private readonly recusarOrcamento: RecusarOrcamentoUseCase,
    @Inject(ORCAMENTO_WEBHOOK_TOKEN_PORT)
    private readonly webhookTokens: OrcamentoWebhookTokenPort,
  ) {}

  @Get('orcamento/aprovar')
  @ApiOperation({ summary: 'Aprovacao de orcamento via link de email' })
  @ApiQuery({ name: 'token', required: true })
  @ApiResponse({ status: 200, description: 'Orcamento aprovado com sucesso' })
  @ApiResponse({ status: 400, description: 'Token incompativel com a acao' })
  @ApiResponse({ status: 401, description: 'Token invalido ou expirado' })
  async aprovar(@Query('token') token: string) {
    const payload = await this.validarToken(token);
    this.validarAcao(payload, 'aprovar');
    await this.aprovarOrcamento.execute({ osId: payload.osId });
    return { mensagem: 'Orcamento aprovado com sucesso.' };
  }

  @Get('orcamento/recusar')
  @ApiOperation({ summary: 'Recusa de orcamento via link de email' })
  @ApiQuery({ name: 'token', required: true })
  @ApiResponse({ status: 200, description: 'Orcamento recusado com sucesso' })
  @ApiResponse({ status: 400, description: 'Token incompativel com a acao' })
  @ApiResponse({ status: 401, description: 'Token invalido ou expirado' })
  async recusar(@Query('token') token: string) {
    const payload = await this.validarToken(token);
    this.validarAcao(payload, 'recusar');
    await this.recusarOrcamento.execute({ osId: payload.osId });
    return { mensagem: 'Orcamento recusado.' };
  }

  private async validarToken(
    token: string | undefined,
  ): Promise<OrcamentoWebhookTokenPayload> {
    if (!token) {
      throw new UnauthorizedException('Token invalido ou expirado');
    }

    try {
      return await this.webhookTokens.validarToken(token);
    } catch {
      throw new UnauthorizedException('Token invalido ou expirado');
    }
  }

  private validarAcao(
    payload: OrcamentoWebhookTokenPayload,
    acaoEsperada: OrcamentoWebhookTokenPayload['acao'],
  ): void {
    if (payload.acao !== acaoEsperada) {
      throw new BadRequestException('Token incompativel com a acao solicitada');
    }
  }
}
