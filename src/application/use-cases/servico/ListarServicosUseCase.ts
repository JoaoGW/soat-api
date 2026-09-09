import { ServicoRepository } from '../../../domain/repositories/ServicoRepository';

interface Input {
  page?: number;
  limit?: number;
  ativo?: boolean;
}

export class ListarServicosUseCase {
  constructor(private readonly servicoRepo: ServicoRepository) {}

  async execute(input: Input = {}) {
    return this.servicoRepo.findAll({
      page: input.page ?? 1,
      limit: input.limit ?? 20,
      ativo: input.ativo ?? true,
    });
  }
}
