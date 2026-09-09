import { Peca } from '../../../domain/entities/Peca';
import { PecaRepository } from '../../../domain/repositories/PecaRepository';
import { ActiveFilter } from '../../../domain/repositories/types';

export class InMemoryPecaRepository implements PecaRepository {
  public items: Peca[] = [];

  async save(peca: Peca): Promise<void> {
    const index = this.items.findIndex((item) => item.getId() === peca.getId());

    if (index >= 0) {
      this.items[index] = peca;
      return;
    }

    this.items.push(peca);
  }

  async findById(id: string): Promise<Peca | null> {
    return this.items.find((item) => item.getId() === id) ?? null;
  }

  async findAll(params?: ActiveFilter): Promise<Peca[]> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const ativo = params?.ativo;
    const filtered =
      ativo === undefined
        ? this.items
        : this.items.filter((item) => item.ativo === ativo);
    const start = (page - 1) * limit;
    return filtered.slice(start, start + limit);
  }
}
