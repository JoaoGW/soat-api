import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CriarServicoDto {
  @ApiProperty({ example: 'Troca de oleo' })
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @ApiProperty({ example: 'Substituicao do oleo do motor e filtro' })
  @IsString()
  @IsNotEmpty()
  descricao!: string;

  @ApiProperty({ example: 15000, description: 'Preco em centavos' })
  @IsInt()
  @Min(0)
  precoEmCentavos!: number;
}
