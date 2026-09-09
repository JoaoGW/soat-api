import { Cliente } from '../../../domain/entities/Cliente';
import { ClienteRepository } from '../../../domain/repositories/ClienteRepository';
import { ActiveFilter } from '../../../domain/repositories/types';

export class InMemoryClienteRepository implements ClienteRepository {
  public items: Cliente[] = [];

  async save(cliente: Cliente): Promise<void> {
    const index = this.items.findIndex(
      (item) => item.getId() === cliente.getId(),
    );

    if (index >= 0) {
      this.items[index] = cliente;
      return;
    }

    this.items.push(cliente);
  }

  async findById(id: string): Promise<Cliente | null> {
    return this.items.find((item) => item.getId() === id) ?? null;
  }

  async findAll(params?: ActiveFilter): Promise<Cliente[]> {
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

  async findByDocumento(documento: string): Promise<Cliente | null> {
    return (
      this.items.find((item) => item.documento.valor === documento) ?? null
    );
  }
}
