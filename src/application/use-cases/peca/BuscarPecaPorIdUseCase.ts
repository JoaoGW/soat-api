import { PecaNaoEncontradaError } from '../../../domain/errors/PecaNaoEncontradaError';
import { PecaRepository } from '../../../domain/repositories/PecaRepository';

export class BuscarPecaPorIdUseCase {
  constructor(private readonly pecaRepo: PecaRepository) {}

  async execute(id: string) {
    const peca = await this.pecaRepo.findById(id);
    if (!peca) throw new PecaNaoEncontradaError();
    return peca;
  }
}
