import { ServicoNaoEncontradoError } from '../../../domain/errors/ServicoNaoEncontradoError';
import { ServicoRepository } from '../../../domain/repositories/ServicoRepository';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';

interface Input {
  id: string;
  nome?: string;
  descricao?: string;
  precoEmCentavos?: number;
}

export class AtualizarServicoUseCase {
  constructor(private readonly servicoRepo: ServicoRepository) {}

  async execute(input: Input): Promise<void> {
    const servico = await this.servicoRepo.findById(input.id);
    if (!servico) throw new ServicoNaoEncontradoError();

    if (input.nome !== undefined) servico.atualizarNome(input.nome);
    if (input.descricao !== undefined)
      servico.atualizarDescricao(input.descricao);
    if (input.precoEmCentavos !== undefined) {
      servico.atualizarPreco(new Dinheiro(input.precoEmCentavos));
    }

    await this.servicoRepo.save(servico);
  }
}
