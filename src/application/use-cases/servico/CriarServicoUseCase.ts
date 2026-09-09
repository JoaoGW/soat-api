import { Servico } from '../../../domain/entities/Servico';
import { ServicoRepository } from '../../../domain/repositories/ServicoRepository';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';

interface Input {
  nome: string;
  descricao: string;
  precoEmCentavos: number;
}

interface Output {
  id: string;
}

export class CriarServicoUseCase {
  constructor(private readonly servicoRepo: ServicoRepository) {}

  async execute(input: Input): Promise<Output> {
    const preco = new Dinheiro(input.precoEmCentavos);
    const servico = Servico.criar(input.nome, input.descricao, preco);
    await this.servicoRepo.save(servico);
    return { id: servico.getId() };
  }
}
