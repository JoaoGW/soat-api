import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AtualizarServicoDto {
  @ApiPropertyOptional({ example: 'Troca de oleo premium' })
  @IsString()
  @IsOptional()
  nome?: string;

  @ApiPropertyOptional({ example: 'Troca de oleo com filtro incluso' })
  @IsString()
  @IsOptional()
  descricao?: string;

  @ApiPropertyOptional({ example: 18000, description: 'Preco em centavos' })
  @IsInt()
  @Min(0)
  @IsOptional()
  precoEmCentavos?: number;
}
