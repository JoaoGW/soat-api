import { OrdemDeServicoNaoEncontradaError } from '../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { OrdemDeServicoRepository } from '../../domain/repositories/OrdemDeServicoRepository';

interface Input {
  osId: string;
}

interface Output {
  valorTotal: number;
}

export class GerarOrcamentoUseCase {
  constructor(private readonly osRepo: OrdemDeServicoRepository) {}

  async execute(input: Input): Promise<Output> {
    const os = await this.osRepo.findById(input.osId);
    if (!os) throw new OrdemDeServicoNaoEncontradaError();

    os.gerarOrcamento();
    await this.osRepo.save(os);

    return {
      valorTotal: os.valorTotal.centavos,
    };
  }
}
