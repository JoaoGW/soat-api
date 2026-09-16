import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ObterTempoMedioExecucaoUseCase,
  RelatorioTempoMedioExecucao,
} from '../../../application/use-cases/ObterTempoMedioExecucaoUseCase';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';

@ApiTags('Relatorios')
@ApiBearerAuth('JWT_ADMIN')
@Controller('relatorios')
@UseGuards(JwtAuthGuard)
export class RelatorioController {
  constructor(
    private readonly obterTempoMedio: ObterTempoMedioExecucaoUseCase,
  ) {}

  @Get('tempo-medio-execucao')
  @ApiOperation({
    summary: 'Tempo medio de execucao dos servicos finalizados',
  })
  @ApiResponse({
    status: 200,
    description: 'Tempo medio calculado em minutos',
    schema: {
      example: {
        mediaEmMinutos: 127,
        totalOSConsideradas: 42,
        etapas: {
          diagnostico: { mediaEmMinutos: 35, totalOSConsideradas: 42 },
          execucao: { mediaEmMinutos: 127, totalOSConsideradas: 42 },
          finalizacao: { mediaEmMinutos: 10, totalOSConsideradas: 40 },
        },
      },
    },
  })
  async tempoMedio(): Promise<RelatorioTempoMedioExecucao> {
    return this.obterTempoMedio.execute();
  }
}
