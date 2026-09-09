import { PecaNaoEncontradaError } from '../../../domain/errors/PecaNaoEncontradaError';
import { PecaRepository } from '../../../domain/repositories/PecaRepository';
import { QuantidadeEstoque } from '../../../domain/value-objects/QuantidadeEstoque';

interface Input {
  pecaId: string;
  novaQuantidade: number;
}

export class AjustarEstoqueUseCase {
  constructor(private readonly pecaRepo: PecaRepository) {}

  async execute(input: Input): Promise<void> {
    const peca = await this.pecaRepo.findById(input.pecaId);
    if (!peca) throw new PecaNaoEncontradaError();

    peca.ajustarEstoque(new QuantidadeEstoque(input.novaQuantidade));
    await this.pecaRepo.save(peca);
  }
}
