import { ClienteNaoEncontradoError } from '../../../domain/errors/ClienteNaoEncontradoError';
import { ClienteRepository } from '../../../domain/repositories/ClienteRepository';

export class BuscarClientePorIdUseCase {
  constructor(private readonly clienteRepo: ClienteRepository) {}

  async execute(id: string) {
    const cliente = await this.clienteRepo.findById(id);
    if (!cliente) throw new ClienteNaoEncontradoError();
    return cliente;
  }
}
