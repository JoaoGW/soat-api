import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AjustarEstoqueDto {
  @ApiProperty({ example: 20 })
  @IsInt()
  @Min(0)
  novaQuantidade!: number;
}
