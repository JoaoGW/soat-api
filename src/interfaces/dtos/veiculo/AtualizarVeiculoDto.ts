import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AtualizarVeiculoDto {
  @ApiPropertyOptional({ example: 'Toyota' })
  @IsString()
  @IsOptional()
  marca?: string;

  @ApiPropertyOptional({ example: 'Corolla XEI' })
  @IsString()
  @IsOptional()
  modelo?: string;

  @ApiPropertyOptional({ example: 2023 })
  @IsInt()
  @Min(1900)
  @IsOptional()
  ano?: number;
}
