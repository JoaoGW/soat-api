import { ClienteNaoEncontradoError } from '../../../domain/errors/ClienteNaoEncontradoError';
import { ClienteRepository } from '../../../domain/repositories/ClienteRepository';

interface Input {
  id: string;
}

export class RemoverClienteUseCase {
  constructor(private readonly clienteRepo: ClienteRepository) {}

  async execute(input: Input): Promise<void> {
    const cliente = await this.clienteRepo.findById(input.id);
    if (!cliente) throw new ClienteNaoEncontradoError();

    cliente.desativar();
    await this.clienteRepo.save(cliente);
  }
}
