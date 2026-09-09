import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AdicionarServicoOSDto {
  @ApiProperty({ example: 'servico-uuid' })
  @IsString()
  @IsNotEmpty()
  servicoId: string;
}
