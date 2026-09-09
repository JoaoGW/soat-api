import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CriarClienteDto {
  @ApiProperty({ example: 'Joao Pedro' })
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @ApiProperty({ example: '12345678909' })
  @IsString()
  @IsNotEmpty()
  documento!: string;

  @ApiProperty({ example: 'joao@email.com' })
  @IsString()
  @IsNotEmpty()
  contato!: string;
}
