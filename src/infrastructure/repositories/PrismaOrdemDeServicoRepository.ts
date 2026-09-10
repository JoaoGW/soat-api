import { Injectable } from '@nestjs/common';
import { OrdemDeServico } from '../../domain/entities/OrdemDeServico';
import { StatusOS } from '../../domain/enums/StatusOS';
import {
  HistoricoStatusOS,
  ListarFilaOperacionalParams,
  OrdemDeServicoRepository,
} from '../../domain/repositories/OrdemDeServicoRepository';
import { PaginationParams } from '../../domain/repositories/types';
import { PrismaService } from '../database/PrismaService';
import { OrdemDeServicoMapper } from '../mappers/OrdemDeServicoMapper';
import { ObservabilityService } from '../observability/ObservabilityService';

@Injectable()
export class PrismaOrdemDeServicoRepository
  implements OrdemDeServicoRepository
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly observability: ObservabilityService,
  ) {}

  async save(os: OrdemDeServico): Promise<void> {
    const metricas = await this.prisma.$transaction(async (tx) => {
      const atual = await tx.ordemDeServico.findUnique({
        where: { id: os.getId() },
        select: { status: true },
      });

      const dadosBase = {
        status: os.status,
        valorTotal: os.valorTotal.centavos,
        orcamentoAprovado: os.orcamentoAprovado,
        orcamentoGerado: os.orcamentoGerado,
        dataInicioExecucao: os.dataInicioExecucao,
        dataFinalizacao: os.dataFinalizacao,
      };
      const itens = {
        create: os.itens.map((item) => ({
          pecaId: item.pecaId,
          quantidade: item.quantidade.valor,
          precoUnitario: item.precoUnitario.centavos,
        })),
      };
      const servicos = {
        create: os.servicos.map((servico) => ({
          servicoId: servico.servicoId,
          precoUnitario: servico.preco.centavos,
        })),
      };

      if (!atual) {
        await tx.ordemDeServico.create({
          data: {
            id: os.getId(),
            codigoAcompanhamento: os.codigoAcompanhamento.valor,
            clienteId: os.clienteId,
            veiculoId: os.veiculoId,
            ...dadosBase,
            itens,
            servicos,
            historicoStatus: {
              create: {
                status: os.status,
                ocorridoEm: os.dataCriacao,
              },
            },
          },
        });
        return { criada: true, houveTransicao: false, status: os.status };
      }

      let tempoEtapa:
        | {
            etapa: 'diagnostico' | 'execucao' | 'finalizacao';
            duracaoEmMs: number;
          }
        | undefined;
      if (atual.status !== String(os.status)) {
        const inicio = this.inicioDaEtapa(os.status);
        if (inicio) {
          const eventoInicial = await tx.historicoStatusOS.findFirst({
            where: { osId: os.getId(), status: inicio },
            orderBy: { ocorridoEm: 'asc' },
          });
          if (eventoInicial)
            tempoEtapa = {
              etapa: this.nomeDaEtapa(os.status),
              duracaoEmMs:
                os.dataAtualizacao.getTime() -
                eventoInicial.ocorridoEm.getTime(),
            };
        }
      }

      await tx.ordemDeServico.update({
        where: { id: os.getId() },
        data: {
          ...dadosBase,
          itens: {
            deleteMany: {},
            ...itens,
          },
          servicos: {
            deleteMany: {},
            ...servicos,
          },
          ...(atual.status !== String(os.status)
            ? {
                historicoStatus: {
                  create: {
                    status: os.status,
                    ocorridoEm: os.dataAtualizacao,
                  },
                },
              }
            : {}),
        },
      });
      return {
        criada: false,
        houveTransicao: atual.status !== String(os.status),
        status: os.status,
        tempoEtapa,
      };
    });

    if (metricas.criada) this.observability.registrarOrdemCriada();
    if (metricas.houveTransicao)
      this.observability.registrarTransicao(metricas.status);
    if (metricas.tempoEtapa)
      this.observability.registrarTempoEtapa(
        metricas.tempoEtapa.etapa,
        metricas.tempoEtapa.duracaoEmMs,
      );
  }

  private inicioDaEtapa(status: StatusOS): StatusOS | undefined {
    if (status === StatusOS.AGUARDANDO_APROVACAO)
      return StatusOS.EM_DIAGNOSTICO;
    if (status === StatusOS.FINALIZADA) return StatusOS.EM_EXECUCAO;
    if (status === StatusOS.ENTREGUE) return StatusOS.FINALIZADA;
    return undefined;
  }

  private nomeDaEtapa(
    status: StatusOS,
  ): 'diagnostico' | 'execucao' | 'finalizacao' {
    if (status === StatusOS.AGUARDANDO_APROVACAO) return 'diagnostico';
    if (status === StatusOS.FINALIZADA) return 'execucao';
    return 'finalizacao';
  }

  async findById(id: string): Promise<OrdemDeServico | null> {
    const ordemData = await this.prisma.ordemDeServico.findUnique({
      where: { id },
      include: { itens: true, servicos: true },
    });
    return ordemData ? OrdemDeServicoMapper.toDomain(ordemData) : null;
  }

  async findByCodigoAcompanhamento(
    codigoAcompanhamento: string,
  ): Promise<OrdemDeServico | null> {
    const ordemData = await this.prisma.ordemDeServico.findUnique({
      where: { codigoAcompanhamento },
      include: { itens: true, servicos: true },
    });
    return ordemData ? OrdemDeServicoMapper.toDomain(ordemData) : null;
  }

  async findAll(
    params?: PaginationParams & { status?: string },
  ): Promise<OrdemDeServico[]> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const ordensData = await this.prisma.ordemDeServico.findMany({
      where: { status: params?.status },
      include: { itens: true, servicos: true },
      skip: (page - 1) * limit,
      take: limit,
    });
    return ordensData.map((ordemData) =>
      OrdemDeServicoMapper.toDomain(ordemData),
    );
  }

  async listarFilaOperacional(
    params?: ListarFilaOperacionalParams,
  ): Promise<OrdemDeServico[]> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    let skip = (page - 1) * limit;
    let remainingTake = limit;
    const statusOperacionais = [
      StatusOS.EM_EXECUCAO,
      StatusOS.AGUARDANDO_APROVACAO,
      StatusOS.EM_DIAGNOSTICO,
      StatusOS.RECEBIDA,
    ];
    const statusPermitidos =
      params?.status === undefined ? statusOperacionais : [params.status];
    const statusFiltrados = statusPermitidos.filter(
      (status): status is StatusOS =>
        statusOperacionais.includes(status as StatusOS),
    );

    if (statusFiltrados.length === 0) return [];

    const resultado: OrdemDeServico[] = [];
    for (const status of statusFiltrados) {
      if (remainingTake === 0) break;

      const totalNoStatus = await this.prisma.ordemDeServico.count({
        where: { status },
      });
      if (skip >= totalNoStatus) {
        skip -= totalNoStatus;
        continue;
      }

      const ordensData = await this.prisma.ordemDeServico.findMany({
        where: { status },
        include: { itens: true, servicos: true },
        orderBy: { createdAt: 'asc' },
        skip,
        take: remainingTake,
      });
      resultado.push(
        ...ordensData.map((ordemData) =>
          OrdemDeServicoMapper.toDomain(ordemData),
        ),
      );
      remainingTake -= ordensData.length;
      skip = 0;
    }
    return resultado;
  }

  async findByClienteId(clienteId: string): Promise<OrdemDeServico[]> {
    const ordensData = await this.prisma.ordemDeServico.findMany({
      where: { clienteId },
      include: { itens: true, servicos: true },
    });
    return ordensData.map((ordemData) =>
      OrdemDeServicoMapper.toDomain(ordemData),
    );
  }

  async findFinalizadasComPeriodoExecucao(): Promise<OrdemDeServico[]> {
    const ordensData = await this.prisma.ordemDeServico.findMany({
      where: {
        dataInicioExecucao: { not: null },
        dataFinalizacao: { not: null },
      },
      include: { itens: true, servicos: true },
    });
    return ordensData.map((ordemData) =>
      OrdemDeServicoMapper.toDomain(ordemData),
    );
  }

  async findHistoricoStatus(): Promise<HistoricoStatusOS[]> {
    const historicos = await this.prisma.historicoStatusOS.findMany({
      orderBy: [{ osId: 'asc' }, { ocorridoEm: 'asc' }],
    });
    return historicos.map((historico) => ({
      osId: historico.osId,
      status: historico.status as StatusOS,
      ocorridoEm: historico.ocorridoEm,
    }));
  }
}
