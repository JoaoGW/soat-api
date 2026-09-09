import { ClienteNaoEncontradoError } from '../../../domain/errors/ClienteNaoEncontradoError';
import { ClienteRepository } from '../../../domain/repositories/ClienteRepository';

interface Input {
  id: string;
  nome?: string;
  contato?: string;
}

export class AtualizarClienteUseCase {
  constructor(private readonly clienteRepo: ClienteRepository) {}

  async execute(input: Input): Promise<void> {
    const cliente = await this.clienteRepo.findById(input.id);
    if (!cliente) throw new ClienteNaoEncontradoError();

    if (input.nome !== undefined) cliente.atualizarNome(input.nome);
    if (input.contato !== undefined) cliente.atualizarContato(input.contato);

    await this.clienteRepo.save(cliente);
  }
}
