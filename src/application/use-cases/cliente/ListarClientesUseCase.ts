import { ClienteRepository } from '../../../domain/repositories/ClienteRepository';

interface Input {
  page?: number;
  limit?: number;
  ativo?: boolean;
}

export class ListarClientesUseCase {
  constructor(private readonly clienteRepo: ClienteRepository) {}

  async execute(input: Input = {}) {
    return this.clienteRepo.findAll({
      page: input.page ?? 1,
      limit: input.limit ?? 20,
      ativo: input.ativo ?? true,
    });
  }
}
