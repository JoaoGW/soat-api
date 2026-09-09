import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConsultarStatusOSUseCase } from '../../../application/use-cases/ConsultarStatusOSUseCase';
import { CodigoAcompanhamentoInvalidoError } from '../../../domain/errors/CodigoAcompanhamentoInvalidoError';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { ConsultaStatusOSResponseDto } from '../../dtos/publico/ConsultaStatusOSResponseDto';

@ApiTags('Consulta publica')
@Controller('consulta')
export class ConsultaPublicaController {
  constructor(private readonly consultarStatusOS: ConsultarStatusOSUseCase) {}

  // Rota publica intencionalmente sem JwtAuthGuard.
  // O cliente acompanha a OS por codigo publico nao sequencial.
  @Get('os/:codigoAcompanhamento/status')
  @ApiOperation({
    summary: 'Consultar status da OS pelo cliente sem autenticacao',
  })
  @ApiResponse({ status: 200, type: ConsultaStatusOSResponseDto })
  @ApiResponse({ status: 404, description: 'OS nao encontrada' })
  async consultarStatus(
    @Param('codigoAcompanhamento') codigoAcompanhamento: string,
  ): Promise<ConsultaStatusOSResponseDto> {
    try {
      return await this.consultarStatusOS.execute({ codigoAcompanhamento });
    } catch (error) {
      if (error instanceof CodigoAcompanhamentoInvalidoError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof OrdemDeServicoNaoEncontradaError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
