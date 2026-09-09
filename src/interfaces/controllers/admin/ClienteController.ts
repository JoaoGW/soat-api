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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';
import { CriarClienteDto } from '../../dtos/cliente/CriarClienteDto';
import { AtualizarClienteDto } from '../../dtos/cliente/AtualizarClienteDto';
import { CriarClienteUseCase } from '../../../application/use-cases/cliente/CriarClienteUseCase';
import { BuscarClientePorIdUseCase } from '../../../application/use-cases/cliente/BuscarClientePorIdUseCase';
import { BuscarClientePorDocumentoUseCase } from '../../../application/use-cases/cliente/BuscarClientePorDocumentoUseCase';
import { ListarClientesUseCase } from '../../../application/use-cases/cliente/ListarClientesUseCase';
import { AtualizarClienteUseCase } from '../../../application/use-cases/cliente/AtualizarClienteUseCase';
import { RemoverClienteUseCase } from '../../../application/use-cases/cliente/RemoverClienteUseCase';

@ApiTags('Clientes')
@ApiBearerAuth('JWT')
@Controller('clientes')
@UseGuards(JwtAuthGuard)
export class ClienteController {
  constructor(
    private readonly criarCliente: CriarClienteUseCase,
    private readonly buscarClientePorId: BuscarClientePorIdUseCase,
    private readonly buscarClientePorDocumento: BuscarClientePorDocumentoUseCase,
    private readonly listarClientes: ListarClientesUseCase,
    private readonly atualizarCliente: AtualizarClienteUseCase,
    private readonly removerCliente: RemoverClienteUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Criar cliente' })
  @ApiResponse({ status: 201, description: 'Cliente criado com sucesso' })
  async criar(@Body() body: CriarClienteDto): Promise<{ id: string }> {
    return this.criarCliente.execute(body);
  }

  @Get()
  @ApiOperation({ summary: 'Listar clientes ou buscar por documento' })
  @ApiQuery({ name: 'documento', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listarOuBuscarPorDocumento(
    @Query('documento') documento?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    if (documento) return this.buscarClientePorDocumento.execute(documento);
    return this.listarClientes.execute({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      ativo: true,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar cliente por ID' })
  async buscarPorId(@Param('id') id: string) {
    return this.buscarClientePorId.execute(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar cliente' })
  async atualizar(@Param('id') id: string, @Body() body: AtualizarClienteDto) {
    return this.atualizarCliente.execute({ id, ...body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desativar cliente' })
  async remover(@Param('id') id: string) {
    return this.removerCliente.execute({ id });
  }
}
