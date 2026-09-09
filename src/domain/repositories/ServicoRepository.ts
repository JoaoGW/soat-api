import { Servico } from '../entities/Servico';
import { ActiveFilter } from './types';

export interface ServicoRepository {
  save(servico: Servico): Promise<void>;
  findById(id: string): Promise<Servico | null>;
  findAll(params?: ActiveFilter): Promise<Servico[]>;
}
