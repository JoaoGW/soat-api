import { ApiProperty } from '@nestjs/swagger';

export class ConsultaStatusOSResponseDto {
  @ApiProperty({ example: 'OS-2026-A8K92P' })
  codigoAcompanhamento: string;

  @ApiProperty({
    example: 'EM_EXECUCAO',
    description: 'Status atual da ordem de servico',
    enum: [
      'RECEBIDA',
      'EM_DIAGNOSTICO',
      'AGUARDANDO_APROVACAO',
      'EM_EXECUCAO',
      'FINALIZADA',
      'ENTREGUE',
      'CANCELADA',
    ],
  })
  status: string;

  @ApiProperty({
    example: 'Seu veiculo esta em execucao de servico.',
    description: 'Descricao amigavel do status atual',
  })
  descricaoStatus: string;

  @ApiProperty({ example: '2026-01-15T10:30:00.000Z' })
  dataAtualizacao: Date;
}
