import { EntidadeEmUsoNaoPodeSerRemovidaError } from '../../../domain/errors/EntidadeEmUsoNaoPodeSerRemovidaError';
import { ServicoNaoEncontradoError } from '../../../domain/errors/ServicoNaoEncontradoError';
import { OrdemDeServicoRepository } from '../../../domain/repositories/OrdemDeServicoRepository';
import { ServicoRepository } from '../../../domain/repositories/ServicoRepository';
import { StatusOS } from '../../../domain/enums/StatusOS';

interface Input {
  id: string;
}

export class RemoverServicoUseCase {
  constructor(
    private readonly servicoRepo: ServicoRepository,
    private readonly osRepo: OrdemDeServicoRepository,
  ) {}

  async execute(input: Input): Promise<void> {
    const servico = await this.servicoRepo.findById(input.id);
    if (!servico) throw new ServicoNaoEncontradoError();

    const ordens = await this.osRepo.findAll();
    const emUso = ordens.some(
      (os) =>
        os.status !== StatusOS.ENTREGUE &&
        os.servicos.some((servicoOs) => servicoOs.servicoId === input.id),
    );
    if (emUso) throw new EntidadeEmUsoNaoPodeSerRemovidaError();

    servico.desativar();
    await this.servicoRepo.save(servico);
  }
}
