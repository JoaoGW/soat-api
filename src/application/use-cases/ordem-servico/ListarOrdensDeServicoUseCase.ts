import { OrdemDeServicoRepository } from '../../../domain/repositories/OrdemDeServicoRepository';

interface Input {
  page?: number;
  limit?: number;
  status?: string;
}

export class ListarOrdensDeServicoUseCase {
  constructor(private readonly osRepo: OrdemDeServicoRepository) {}

  async execute(input: Input = {}) {
    return this.osRepo.listarFilaOperacional({
      page: input.page ?? 1,
      limit: input.limit ?? 20,
      status: input.status,
    });
  }
}
