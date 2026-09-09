import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CriarVeiculoDto {
  @ApiProperty({ example: 'cliente-uuid' })
  @IsString()
  @IsNotEmpty()
  clienteId!: string;

  @ApiProperty({ example: 'ABC1D23' })
  @IsString()
  @IsNotEmpty()
  placa!: string;

  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @IsNotEmpty()
  marca!: string;

  @ApiProperty({ example: 'Corolla' })
  @IsString()
  @IsNotEmpty()
  modelo!: string;

  @ApiProperty({ example: 2022 })
  @IsInt()
  @Min(1900)
  ano!: number;
}
