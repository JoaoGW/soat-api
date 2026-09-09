import { Veiculo } from '../../../domain/entities/Veiculo';
import { VeiculoRepository } from '../../../domain/repositories/VeiculoRepository';
import { ActiveFilter } from '../../../domain/repositories/types';

export class InMemoryVeiculoRepository implements VeiculoRepository {
  public items: Veiculo[] = [];

  async save(veiculo: Veiculo): Promise<void> {
    const index = this.items.findIndex(
      (item) => item.getId() === veiculo.getId(),
    );

    if (index >= 0) {
      this.items[index] = veiculo;
      return;
    }

    this.items.push(veiculo);
  }

  async findById(id: string): Promise<Veiculo | null> {
    return this.items.find((item) => item.getId() === id) ?? null;
  }

  async findAll(params?: ActiveFilter): Promise<Veiculo[]> {
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

  async findByClienteId(
    clienteId: string,
    params?: { ativo?: boolean },
  ): Promise<Veiculo[]> {
    const filtered = this.items.filter((item) => item.clienteId === clienteId);
    if (params?.ativo === undefined) return filtered;
    return filtered.filter((item) => item.ativo === params.ativo);
  }

  async findByPlaca(placa: string): Promise<Veiculo | null> {
    return this.items.find((item) => item.placa.valor === placa) ?? null;
  }
}
