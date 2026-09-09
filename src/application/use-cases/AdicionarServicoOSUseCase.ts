import { OrdemDeServicoNaoEncontradaError } from '../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { ServicoNaoEncontradoError } from '../../domain/errors/ServicoNaoEncontradoError';
import { OrdemDeServicoRepository } from '../../domain/repositories/OrdemDeServicoRepository';
import { ServicoRepository } from '../../domain/repositories/ServicoRepository';

interface Input {
  osId: string;
  servicoId: string;
}

export class AdicionarServicoOSUseCase {
  constructor(
    private readonly osRepo: OrdemDeServicoRepository,
    private readonly servicoRepo: ServicoRepository,
  ) {}

  async execute(input: Input): Promise<void> {
    const os = await this.osRepo.findById(input.osId);
    if (!os) throw new OrdemDeServicoNaoEncontradaError();

    const servico = await this.servicoRepo.findById(input.servicoId);
    if (!servico) throw new ServicoNaoEncontradoError();

    os.adicionarServico(servico.getId(), servico.preco);
    await this.osRepo.save(os);
  }
}
