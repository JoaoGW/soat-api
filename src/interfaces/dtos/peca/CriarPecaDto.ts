import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CriarPecaDto {
  @ApiProperty({ example: 'Filtro de oleo' })
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @ApiProperty({ example: 4500, description: 'Preco em centavos' })
  @IsInt()
  @Min(0)
  precoEmCentavos!: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  quantidadeEstoque!: number;
}
