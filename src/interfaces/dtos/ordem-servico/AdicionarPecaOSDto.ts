import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class AdicionarPecaOSDto {
  @ApiProperty({ example: 'peca-uuid' })
  @IsString()
  @IsNotEmpty()
  pecaId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantidade: number;
}
