import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class ServicoOrdemDeServicoDto {
  @ApiProperty({ example: 'servico-uuid' })
  @IsString()
  @IsNotEmpty()
  servicoId: string;
}

class PecaOrdemDeServicoDto {
  @ApiProperty({ example: 'peca-uuid' })
  @IsString()
  @IsNotEmpty()
  pecaId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantidade: number;
}

export class CriarOrdemDeServicoDto {
  @ApiProperty({ example: 'cliente-uuid' })
  @IsString()
  @IsNotEmpty()
  clienteId: string;

  @ApiProperty({ example: 'veiculo-uuid' })
  @IsString()
  @IsNotEmpty()
  veiculoId: string;

  @ApiPropertyOptional({ type: [ServicoOrdemDeServicoDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServicoOrdemDeServicoDto)
  servicos?: ServicoOrdemDeServicoDto[];

  @ApiPropertyOptional({ type: [PecaOrdemDeServicoDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PecaOrdemDeServicoDto)
  pecas?: PecaOrdemDeServicoDto[];
}
