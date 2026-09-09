import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { OrdemDeServicoRepository } from '../../../domain/repositories/OrdemDeServicoRepository';

export class BuscarOrdemDeServicoPorIdUseCase {
  constructor(private readonly osRepo: OrdemDeServicoRepository) {}

  async execute(id: string) {
    const os = await this.osRepo.findById(id);
    if (!os) throw new OrdemDeServicoNaoEncontradaError();
    return os;
  }
}
