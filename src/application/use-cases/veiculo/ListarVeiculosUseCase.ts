import { VeiculoRepository } from '../../../domain/repositories/VeiculoRepository';

interface Input {
  page?: number;
  limit?: number;
  ativo?: boolean;
}

export class ListarVeiculosUseCase {
  constructor(private readonly veiculoRepo: VeiculoRepository) {}

  async execute(input: Input = {}) {
    return this.veiculoRepo.findAll({
      page: input.page ?? 1,
      limit: input.limit ?? 20,
      ativo: input.ativo ?? true,
    });
  }
}
