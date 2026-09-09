import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { CriarPecaDto } from '../../dtos/peca/CriarPecaDto';
import { AtualizarPecaDto } from '../../dtos/peca/AtualizarPecaDto';
import { AjustarEstoqueDto } from '../../dtos/peca/AjustarEstoqueDto';
import { CriarPecaUseCase } from '../../../application/use-cases/peca/CriarPecaUseCase';
import { BuscarPecaPorIdUseCase } from '../../../application/use-cases/peca/BuscarPecaPorIdUseCase';
import { ListarPecasUseCase } from '../../../application/use-cases/peca/ListarPecasUseCase';
import { AtualizarPecaUseCase } from '../../../application/use-cases/peca/AtualizarPecaUseCase';
import { AjustarEstoqueUseCase } from '../../../application/use-cases/peca/AjustarEstoqueUseCase';
import { RemoverPecaUseCase } from '../../../application/use-cases/peca/RemoverPecaUseCase';

@ApiTags('Pecas')
@ApiBearerAuth('JWT')
@Controller('pecas')
@UseGuards(JwtAuthGuard)
export class PecaController {
  constructor(
    private readonly criarPeca: CriarPecaUseCase,
    private readonly buscarPecaPorId: BuscarPecaPorIdUseCase,
    private readonly listarPecas: ListarPecasUseCase,
    private readonly atualizarPeca: AtualizarPecaUseCase,
    private readonly ajustarEstoque: AjustarEstoqueUseCase,
    private readonly removerPeca: RemoverPecaUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Criar peca' })
  async criar(@Body() body: CriarPecaDto): Promise<{ id: string }> {
    return this.criarPeca.execute(body);
  }

  @Get()
  @ApiOperation({ summary: 'Listar pecas' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listar(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.listarPecas.execute({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      ativo: true,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar peca por ID' })
  async buscarPorId(@Param('id') id: string) {
    return this.buscarPecaPorId.execute(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar peca' })
  async atualizar(@Param('id') id: string, @Body() body: AtualizarPecaDto) {
    return this.atualizarPeca.execute({ id, ...body });
  }

  @Patch(':id/estoque')
  @ApiOperation({ summary: 'Ajustar estoque manualmente' })
  async ajustar(@Param('id') id: string, @Body() body: AjustarEstoqueDto) {
    return this.ajustarEstoque.execute({
      pecaId: id,
      novaQuantidade: body.novaQuantidade,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desativar peca' })
  async remover(@Param('id') id: string) {
    return this.removerPeca.execute({ id });
  }
}
