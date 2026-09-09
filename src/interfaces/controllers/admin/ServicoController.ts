import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';
import { CriarServicoDto } from '../../dtos/servico/CriarServicoDto';
import { AtualizarServicoDto } from '../../dtos/servico/AtualizarServicoDto';
import { CriarServicoUseCase } from '../../../application/use-cases/servico/CriarServicoUseCase';
import { BuscarServicoPorIdUseCase } from '../../../application/use-cases/servico/BuscarServicoPorIdUseCase';
import { ListarServicosUseCase } from '../../../application/use-cases/servico/ListarServicosUseCase';
import { AtualizarServicoUseCase } from '../../../application/use-cases/servico/AtualizarServicoUseCase';
import { RemoverServicoUseCase } from '../../../application/use-cases/servico/RemoverServicoUseCase';

@ApiTags('Servicos')
@ApiBearerAuth('JWT')
@Controller('servicos')
@UseGuards(JwtAuthGuard)
export class ServicoController {
  constructor(
    private readonly criarServico: CriarServicoUseCase,
    private readonly buscarServicoPorId: BuscarServicoPorIdUseCase,
    private readonly listarServicos: ListarServicosUseCase,
    private readonly atualizarServico: AtualizarServicoUseCase,
    private readonly removerServico: RemoverServicoUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Criar servico' })
  async criar(@Body() body: CriarServicoDto): Promise<{ id: string }> {
    return this.criarServico.execute(body);
  }

  @Get()
  @ApiOperation({ summary: 'Listar servicos' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listar(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.listarServicos.execute({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      ativo: true,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar servico por ID' })
  async buscarPorId(@Param('id') id: string) {
    return this.buscarServicoPorId.execute(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar servico' })
  async atualizar(@Param('id') id: string, @Body() body: AtualizarServicoDto) {
    return this.atualizarServico.execute({ id, ...body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desativar servico' })
  async remover(@Param('id') id: string) {
    return this.removerServico.execute({ id });
  }
}
