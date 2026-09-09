import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
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
import { ListarOrdensDeServicoUseCase } from '../../../application/use-cases/ordem-servico/ListarOrdensDeServicoUseCase';
import { BuscarOrdemDeServicoPorIdUseCase } from '../../../application/use-cases/ordem-servico/BuscarOrdemDeServicoPorIdUseCase';
import { CriarOrdemDeServicoUseCase } from '../../../application/use-cases/CriarOrdemDeServicoUseCase';
import { IniciarDiagnosticoUseCase } from '../../../application/use-cases/IniciarDiagnosticoUseCase';
import { AdicionarServicoOSUseCase } from '../../../application/use-cases/AdicionarServicoOSUseCase';
import { AdicionarPecaOSUseCase } from '../../../application/use-cases/AdicionarPecaOSUseCase';
import { GerarOrcamentoUseCase } from '../../../application/use-cases/GerarOrcamentoUseCase';
import { EnviarOrcamentoParaAprovacaoUseCase } from '../../../application/use-cases/EnviarOrcamentoParaAprovacaoUseCase';
import { AprovarOrcamentoUseCase } from '../../../application/use-cases/AprovarOrcamentoUseCase';
import { RecusarOrcamentoUseCase } from '../../../application/use-cases/RecusarOrcamentoUseCase';
import { IniciarExecucaoUseCase } from '../../../application/use-cases/IniciarExecucaoUseCase';
import { FinalizarServicoUseCase } from '../../../application/use-cases/FinalizarServicoUseCase';
import { EntregarVeiculoUseCase } from '../../../application/use-cases/EntregarVeiculoUseCase';
import { CriarOrdemDeServicoDto } from '../../dtos/ordem-servico/CriarOrdemDeServicoDto';
import { AdicionarServicoOSDto } from '../../dtos/ordem-servico/AdicionarServicoOSDto';
import { AdicionarPecaOSDto } from '../../dtos/ordem-servico/AdicionarPecaOSDto';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { OrcamentoNaoPodeSerGeradoError } from '../../../domain/errors/OrcamentoNaoPodeSerGeradoError';
import { OrdemDeServicoSemServicoError } from '../../../domain/errors/OrdemDeServicoSemServicoError';
import { TransicaoStatusInvalidaError } from '../../../domain/errors/TransicaoStatusInvalidaError';

@ApiTags('Ordens de Servico')
@ApiBearerAuth('JWT')
@Controller('ordens-servico')
@UseGuards(JwtAuthGuard)
export class OrdemDeServicoController {
  constructor(
    private readonly criarOrdem: CriarOrdemDeServicoUseCase,
    private readonly iniciarDiagnostico: IniciarDiagnosticoUseCase,
    private readonly adicionarServico: AdicionarServicoOSUseCase,
    private readonly adicionarPeca: AdicionarPecaOSUseCase,
    private readonly gerarOrcamento: GerarOrcamentoUseCase,
    private readonly enviarOrcamento: EnviarOrcamentoParaAprovacaoUseCase,
    private readonly aprovarOrcamento: AprovarOrcamentoUseCase,
    private readonly recusarOrcamento: RecusarOrcamentoUseCase,
    private readonly iniciarExecucao: IniciarExecucaoUseCase,
    private readonly finalizarServico: FinalizarServicoUseCase,
    private readonly entregarVeiculo: EntregarVeiculoUseCase,
    private readonly listarOrdens: ListarOrdensDeServicoUseCase,
    private readonly buscarOrdemPorId: BuscarOrdemDeServicoPorIdUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Abrir ordem de servico',
    description:
      'Recebe cliente, veiculo e opcionalmente servicos e pecas. ' +
      'Servicos e pecas tambem podem ser adicionados posteriormente via endpoints do fluxo.',
  })
  @ApiResponse({
    status: 201,
    description: 'Ordem de servico criada com sucesso',
  })
  @ApiResponse({ status: 400, description: 'Dados invalidos' })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  async criar(@Body() body: CriarOrdemDeServicoDto): Promise<{
    id: string;
    codigoAcompanhamento: string;
    status: string;
    dataCriacao: Date;
  }> {
    return this.criarOrdem.execute(body);
  }

  @Get()
  @ApiOperation({ summary: 'Listar ordens de servico' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de ordens retornada com sucesso',
  })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  async listar(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    return this.listarOrdens.execute({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar ordem de servico por ID' })
  @ApiResponse({ status: 200, description: 'Ordem encontrada com sucesso' })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async buscarPorId(@Param('id') id: string) {
    return this.buscarOrdemPorId.execute(id);
  }

  @Post(':id/iniciar-diagnostico')
  @ApiOperation({ summary: 'Iniciar diagnostico da OS' })
  @ApiResponse({ status: 200, description: 'Diagnostico iniciado com sucesso' })
  @ApiResponse({ status: 400, description: 'Transicao de status invalida' })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async iniciarDiagnosticoOS(@Param('id') id: string) {
    return this.iniciarDiagnostico.execute({ osId: id });
  }

  @Post(':id/servicos')
  @ApiOperation({ summary: 'Adicionar servico na OS' })
  @ApiResponse({ status: 200, description: 'Servico adicionado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados invalidos' })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'OS ou servico nao encontrado' })
  async adicionarServicoOS(
    @Param('id') id: string,
    @Body() body: AdicionarServicoOSDto,
  ) {
    return this.adicionarServico.execute({
      osId: id,
      servicoId: body.servicoId,
    });
  }

  @Post(':id/pecas')
  @ApiOperation({ summary: 'Adicionar peca na OS' })
  @ApiResponse({ status: 200, description: 'Peca adicionada com sucesso' })
  @ApiResponse({
    status: 400,
    description: 'Dados invalidos ou estoque insuficiente',
  })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'OS ou peca nao encontrada' })
  async adicionarPecaOS(
    @Param('id') id: string,
    @Body() body: AdicionarPecaOSDto,
  ) {
    return this.adicionarPeca.execute({
      osId: id,
      pecaId: body.pecaId,
      quantidade: body.quantidade,
    });
  }

  @Post(':id/gerar-orcamento')
  @ApiOperation({ summary: 'Gerar orcamento da OS' })
  @ApiResponse({ status: 200, description: 'Orcamento gerado com sucesso' })
  @ApiResponse({
    status: 400,
    description: 'OS fora de estado para gerar orcamento ou sem servicos',
  })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async gerarOrcamentoOS(
    @Param('id') id: string,
  ): Promise<{ valorTotal: number }> {
    try {
      return await this.gerarOrcamento.execute({ osId: id });
    } catch (error) {
      if (error instanceof OrdemDeServicoNaoEncontradaError) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof OrcamentoNaoPodeSerGeradoError ||
        error instanceof OrdemDeServicoSemServicoError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post(':id/enviar-orcamento')
  @ApiOperation({ summary: 'Enviar orcamento para aprovacao' })
  @ApiResponse({ status: 200, description: 'Orcamento enviado para aprovacao' })
  @ApiResponse({
    status: 400,
    description: 'Orcamento nao gerado ou status invalido',
  })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async enviarOrcamentoOS(@Param('id') id: string) {
    return this.enviarOrcamento.execute({ osId: id });
  }

  @Post(':id/aprovar-orcamento')
  @ApiOperation({ summary: 'Aprovar orcamento da OS' })
  @ApiResponse({ status: 200, description: 'Orcamento aprovado com sucesso' })
  @ApiResponse({ status: 400, description: 'Status invalido para aprovacao' })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async aprovarOrcamentoOS(@Param('id') id: string) {
    return this.aprovarOrcamento.execute({ osId: id });
  }

  @Post(':id/recusar-orcamento')
  @ApiOperation({
    summary: 'Recusar orcamento da OS (rota administrativa)',
    description:
      'Recusa administrativa do orcamento. Para recusa via link de email pelo cliente, use o webhook da Fase 2.3.',
  })
  @ApiResponse({ status: 200, description: 'Orcamento recusado, OS cancelada' })
  @ApiResponse({ status: 400, description: 'Status invalido para recusa' })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async recusarOrcamentoOS(@Param('id') id: string) {
    try {
      return await this.recusarOrcamento.execute({ osId: id });
    } catch (error) {
      if (error instanceof OrdemDeServicoNaoEncontradaError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof TransicaoStatusInvalidaError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post(':id/iniciar-execucao')
  @ApiOperation({ summary: 'Iniciar execucao da OS' })
  @ApiResponse({ status: 200, description: 'Execucao iniciada com sucesso' })
  @ApiResponse({
    status: 400,
    description: 'OS nao aprovada ou estoque insuficiente',
  })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'OS ou peca nao encontrada' })
  async iniciarExecucaoOS(@Param('id') id: string) {
    return this.iniciarExecucao.execute({ osId: id });
  }

  @Post(':id/finalizar')
  @ApiOperation({ summary: 'Finalizar servico da OS' })
  @ApiResponse({ status: 200, description: 'Servico finalizado com sucesso' })
  @ApiResponse({ status: 400, description: 'Status invalido para finalizacao' })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async finalizarOS(@Param('id') id: string) {
    return this.finalizarServico.execute({ osId: id });
  }

  @Post(':id/entregar')
  @ApiOperation({ summary: 'Entregar veiculo da OS' })
  @ApiResponse({ status: 200, description: 'Veiculo entregue com sucesso' })
  @ApiResponse({ status: 400, description: 'Status invalido para entrega' })
  @ApiResponse({ status: 401, description: 'Token JWT ausente ou invalido' })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async entregarOS(@Param('id') id: string) {
    return this.entregarVeiculo.execute({ osId: id });
  }
}
