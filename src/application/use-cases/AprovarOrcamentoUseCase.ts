import { OrdemDeServicoNaoEncontradaError } from '../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { OrdemDeServicoRepository } from '../../domain/repositories/OrdemDeServicoRepository';

interface Input {
  osId: string;
}

export class AprovarOrcamentoUseCase {
  constructor(private readonly osRepo: OrdemDeServicoRepository) {}

  async execute(input: Input): Promise<void> {
    const os = await this.osRepo.findById(input.osId);
    if (!os) throw new OrdemDeServicoNaoEncontradaError();

    os.aprovarOrcamento();
    await this.osRepo.save(os);
  }
}
