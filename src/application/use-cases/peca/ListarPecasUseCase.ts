import { PecaRepository } from '../../../domain/repositories/PecaRepository';

interface Input {
  page?: number;
  limit?: number;
  ativo?: boolean;
}

export class ListarPecasUseCase {
  constructor(private readonly pecaRepo: PecaRepository) {}

  async execute(input: Input = {}) {
    return this.pecaRepo.findAll({
      page: input.page ?? 1,
      limit: input.limit ?? 20,
      ativo: input.ativo ?? true,
    });
  }
}
