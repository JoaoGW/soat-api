import { OrdemDeServico } from '../entities/OrdemDeServico';
import { StatusOS } from '../enums/StatusOS';
import { PaginationParams } from './types';

export interface ListarFilaOperacionalParams extends PaginationParams {
  status?: string;
}

export interface HistoricoStatusOS {
  osId: string;
  status: StatusOS;
  ocorridoEm: Date;
}

export interface OrdemDeServicoRepository {
  save(os: OrdemDeServico): Promise<void>;
  findById(id: string): Promise<OrdemDeServico | null>;
  findByCodigoAcompanhamento(
    codigoAcompanhamento: string,
  ): Promise<OrdemDeServico | null>;
  findAll(
    params?: PaginationParams & {
      status?: string;
    },
  ): Promise<OrdemDeServico[]>;
  listarFilaOperacional(
    params?: ListarFilaOperacionalParams,
  ): Promise<OrdemDeServico[]>;
  findByClienteId(clienteId: string): Promise<OrdemDeServico[]>;
  findFinalizadasComPeriodoExecucao?(): Promise<OrdemDeServico[]>;
  findHistoricoStatus(): Promise<HistoricoStatusOS[]>;
}
