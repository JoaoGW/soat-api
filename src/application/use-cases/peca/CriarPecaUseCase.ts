import { Peca } from '../../../domain/entities/Peca';
import { PecaRepository } from '../../../domain/repositories/PecaRepository';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';
import { QuantidadeEstoque } from '../../../domain/value-objects/QuantidadeEstoque';

interface Input {
  nome: string;
  precoEmCentavos: number;
  quantidadeEstoque: number;
}

interface Output {
  id: string;
}

export class CriarPecaUseCase {
  constructor(private readonly pecaRepo: PecaRepository) {}

  async execute(input: Input): Promise<Output> {
    const preco = new Dinheiro(input.precoEmCentavos);
    const estoque = new QuantidadeEstoque(input.quantidadeEstoque);
    const peca = Peca.criar(input.nome, preco, estoque.valor);
    await this.pecaRepo.save(peca);
    return { id: peca.getId() };
  }
}
