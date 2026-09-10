import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AprovarOrcamentoUseCase } from '../../../application/use-cases/AprovarOrcamentoUseCase';
import { RecusarOrcamentoUseCase } from '../../../application/use-cases/RecusarOrcamentoUseCase';
import { BuscarOrdemDeServicoPorIdUseCase } from '../../../application/use-cases/ordem-servico/BuscarOrdemDeServicoPorIdUseCase';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { TransicaoStatusInvalidaError } from '../../../domain/errors/TransicaoStatusInvalidaError';
import { JwtClienteAuthGuard } from '../../guards/JwtClienteAuthGuard';
import { ClienteAutenticado } from '../../strategies/JwtClienteStrategy';

interface RequisicaoCliente {
  user: ClienteAutenticado;
}

@ApiTags('Cliente - Ordens de Servico')
@ApiBearerAuth('JWT_CLIENTE')
@Controller('cliente/ordens-servico')
@UseGuards(JwtClienteAuthGuard)
export class ClienteOrdemServicoController {
  constructor(
    private readonly buscarOrdemPorId: BuscarOrdemDeServicoPorIdUseCase,
    private readonly aprovarOrcamento: AprovarOrcamentoUseCase,
    private readonly recusarOrcamento: RecusarOrcamentoUseCase,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Consultar a propria ordem de servico' })
  @ApiResponse({
    status: 200,
    description: 'Ordem de servico encontrada',
    schema: {
      example: {
        id: '7d0f6d4e-9565-4f2a-a510-434da97d89e0',
        codigoAcompanhamento: 'OS-2026-ABC123',
        status: 'AGUARDANDO_APROVACAO',
        valorTotalEmCentavos: 10000,
        orcamentoGerado: true,
        orcamentoAprovado: false,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description:
      'Exemplo: token ausente, token inválido, issuer/audience incorretos ou papel administrativo.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Ordem de servico pertence a outro cliente',
    schema: {
      example: {
        statusCode: 403,
        message: 'Acesso negado para esta ordem de servico',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async buscar(@Param('id') id: string, @Req() request: RequisicaoCliente) {
    const os = await this.buscarOrdemDoCliente(id, request.user.clienteId);
    return this.apresentar(os);
  }

  @Post(':id/aprovar-orcamento')
  @ApiOperation({ summary: 'Aprovar o orcamento da propria OS' })
  @ApiResponse({ status: 200, description: 'Orcamento aprovado com sucesso' })
  @ApiResponse({ status: 400, description: 'Status invalido para aprovacao' })
  @ApiResponse({
    status: 401,
    description:
      'Exemplo: token ausente, token inválido, issuer/audience incorretos ou papel administrativo.',
  })
  @ApiResponse({
    status: 403,
    description: 'Ordem de servico pertence a outro cliente',
    schema: {
      example: {
        statusCode: 403,
        message: 'Acesso negado para esta ordem de servico',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async aprovar(@Param('id') id: string, @Req() request: RequisicaoCliente) {
    await this.buscarOrdemDoCliente(id, request.user.clienteId);

    try {
      await this.aprovarOrcamento.execute({ osId: id });
    } catch (error) {
      this.tratarErroDeTransicao(error);
    }
  }

  @Post(':id/recusar-orcamento')
  @ApiOperation({ summary: 'Recusar o orcamento da propria OS' })
  @ApiResponse({ status: 200, description: 'Orcamento recusado, OS cancelada' })
  @ApiResponse({ status: 400, description: 'Status invalido para recusa' })
  @ApiResponse({
    status: 401,
    description:
      'Exemplo: token ausente, token inválido, issuer/audience incorretos ou papel administrativo.',
  })
  @ApiResponse({
    status: 403,
    description: 'Ordem de servico pertence a outro cliente',
    schema: {
      example: {
        statusCode: 403,
        message: 'Acesso negado para esta ordem de servico',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Ordem de servico nao encontrada' })
  async recusar(@Param('id') id: string, @Req() request: RequisicaoCliente) {
    await this.buscarOrdemDoCliente(id, request.user.clienteId);

    try {
      await this.recusarOrcamento.execute({ osId: id });
    } catch (error) {
      this.tratarErroDeTransicao(error);
    }
  }

  private async buscarOrdemDoCliente(
    id: string,
    clienteId: string,
  ): Promise<OrdemDeServico> {
    try {
      const os = await this.buscarOrdemPorId.execute(id);
      if (os.clienteId !== clienteId) {
        throw new ForbiddenException(
          'Acesso negado para esta ordem de servico',
        );
      }
      return os;
    } catch (error) {
      if (error instanceof OrdemDeServicoNaoEncontradaError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  private tratarErroDeTransicao(error: unknown): never {
    if (error instanceof OrdemDeServicoNaoEncontradaError) {
      throw new NotFoundException(error.message);
    }
    if (error instanceof TransicaoStatusInvalidaError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }

  private apresentar(os: OrdemDeServico) {
    return {
      id: os.getId(),
      codigoAcompanhamento: os.codigoAcompanhamento.valor,
      status: os.status,
      valorTotalEmCentavos: os.valorTotal.centavos,
      orcamentoGerado: os.orcamentoGerado,
      orcamentoAprovado: os.orcamentoAprovado,
      dataCriacao: os.dataCriacao,
      dataAtualizacao: os.dataAtualizacao,
      dataInicioExecucao: os.dataInicioExecucao,
      dataFinalizacao: os.dataFinalizacao,
    };
  }
}
