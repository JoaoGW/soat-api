import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { StatusOS } from '../../../domain/enums/StatusOS';
import {
  HistoricoStatusOS,
  ListarFilaOperacionalParams,
  OrdemDeServicoRepository,
} from '../../../domain/repositories/OrdemDeServicoRepository';
import { PaginationParams } from '../../../domain/repositories/types';

export class InMemoryOrdemDeServicoRepository
  implements OrdemDeServicoRepository
{
  public items: OrdemDeServico[] = [];
  public historicoStatus: HistoricoStatusOS[] = [];
  private readonly statusPorOS = new Map<string, StatusOS>();

  async save(os: OrdemDeServico): Promise<void> {
    const index = this.items.findIndex((item) => item.getId() === os.getId());
    const statusAnterior = this.statusPorOS.get(os.getId());
    if (statusAnterior !== os.status) {
      this.historicoStatus.push({
        osId: os.getId(),
        status: os.status,
        ocorridoEm: statusAnterior ? os.dataAtualizacao : os.dataCriacao,
      });
      this.statusPorOS.set(os.getId(), os.status);
    }

    if (index >= 0) {
      this.items[index] = os;
      return;
    }

    this.items.push(os);
  }

  async findById(id: string): Promise<OrdemDeServico | null> {
    return this.items.find((item) => item.getId() === id) ?? null;
  }

  async findByCodigoAcompanhamento(
    codigoAcompanhamento: string,
  ): Promise<OrdemDeServico | null> {
    return (
      this.items.find(
        (item) => item.codigoAcompanhamento.valor === codigoAcompanhamento,
      ) ?? null
    );
  }

  async findAll(
    params?: PaginationParams & {
      status?: string;
    },
  ): Promise<OrdemDeServico[]> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const status = params?.status;
    const filtered =
      status === undefined
        ? this.items
        : this.items.filter((item) => item.status === status);
    const start = (page - 1) * limit;
    return filtered.slice(start, start + limit);
  }

  async listarFilaOperacional(
    params?: ListarFilaOperacionalParams,
  ): Promise<OrdemDeServico[]> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const statusOperacionais = [
      StatusOS.EM_EXECUCAO,
      StatusOS.AGUARDANDO_APROVACAO,
      StatusOS.EM_DIAGNOSTICO,
      StatusOS.RECEBIDA,
    ];
    const statusPermitidos =
      params?.status === undefined ? statusOperacionais : [params.status];
    const prioridade = new Map<StatusOS, number>(
      statusOperacionais.map((status, index) => [status, index + 1]),
    );

    const filtered = this.items
      .filter((item) => statusPermitidos.includes(item.status))
      .filter((item) => statusOperacionais.includes(item.status))
      .sort((ordemAtual, proximaOrdem) => {
        const diferencaPrioridade =
          (prioridade.get(ordemAtual.status) ?? Number.MAX_SAFE_INTEGER) -
          (prioridade.get(proximaOrdem.status) ?? Number.MAX_SAFE_INTEGER);
        if (diferencaPrioridade !== 0) return diferencaPrioridade;
        return (
          ordemAtual.dataCriacao.getTime() - proximaOrdem.dataCriacao.getTime()
        );
      });

    const start = (page - 1) * limit;
    return filtered.slice(start, start + limit);
  }

  async findByClienteId(clienteId: string): Promise<OrdemDeServico[]> {
    return this.items.filter((item) => item.clienteId === clienteId);
  }

  async findFinalizadasComPeriodoExecucao(): Promise<OrdemDeServico[]> {
    return this.items.filter(
      (item) =>
        item.dataInicioExecucao !== undefined &&
        item.dataFinalizacao !== undefined,
    );
  }

  async findHistoricoStatus(): Promise<HistoricoStatusOS[]> {
    return [...this.historicoStatus];
  }
}
