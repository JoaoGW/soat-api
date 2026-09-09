import { Peca } from '../entities/Peca';
import { ActiveFilter } from './types';

export interface PecaRepository {
  save(peca: Peca): Promise<void>;
  findById(id: string): Promise<Peca | null>;
  findAll(params?: ActiveFilter): Promise<Peca[]>;
}
