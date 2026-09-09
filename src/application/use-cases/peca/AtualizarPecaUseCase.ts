import { PecaNaoEncontradaError } from '../../../domain/errors/PecaNaoEncontradaError';
import { PecaRepository } from '../../../domain/repositories/PecaRepository';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';

interface Input {
  id: string;
  nome?: string;
  precoEmCentavos?: number;
}

export class AtualizarPecaUseCase {
  constructor(private readonly pecaRepo: PecaRepository) {}

  async execute(input: Input): Promise<void> {
    const peca = await this.pecaRepo.findById(input.id);
    if (!peca) throw new PecaNaoEncontradaError();

    if (input.nome !== undefined) peca.atualizarNome(input.nome);
    if (input.precoEmCentavos !== undefined) {
      peca.atualizarPreco(new Dinheiro(input.precoEmCentavos));
    }

    await this.pecaRepo.save(peca);
  }
}
