import { Servico } from '../../../domain/entities/Servico';
import { ServicoRepository } from '../../../domain/repositories/ServicoRepository';
import { ActiveFilter } from '../../../domain/repositories/types';

export class InMemoryServicoRepository implements ServicoRepository {
  public items: Servico[] = [];

  async save(servico: Servico): Promise<void> {
    const index = this.items.findIndex(
      (item) => item.getId() === servico.getId(),
    );

    if (index >= 0) {
      this.items[index] = servico;
      return;
    }

    this.items.push(servico);
  }

  async findById(id: string): Promise<Servico | null> {
    return this.items.find((item) => item.getId() === id) ?? null;
  }

  async findAll(params?: ActiveFilter): Promise<Servico[]> {
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
