import { Cliente } from '../entities/Cliente';
import { ActiveFilter } from './types';

export interface ClienteRepository {
  save(cliente: Cliente): Promise<void>;
  findById(id: string): Promise<Cliente | null>;
  findAll(params?: ActiveFilter): Promise<Cliente[]>;
  findByDocumento(documento: string): Promise<Cliente | null>;
}
