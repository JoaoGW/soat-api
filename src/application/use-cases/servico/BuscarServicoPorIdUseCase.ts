import { ServicoNaoEncontradoError } from '../../../domain/errors/ServicoNaoEncontradoError';
import { ServicoRepository } from '../../../domain/repositories/ServicoRepository';

export class BuscarServicoPorIdUseCase {
  constructor(private readonly servicoRepo: ServicoRepository) {}

  async execute(id: string) {
    const servico = await this.servicoRepo.findById(id);
    if (!servico) throw new ServicoNaoEncontradoError();
    return servico;
  }
}
