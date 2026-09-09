import { StatusOS } from '../../../domain/enums/StatusOS';
import { EntidadeEmUsoNaoPodeSerRemovidaError } from '../../../domain/errors/EntidadeEmUsoNaoPodeSerRemovidaError';
import { PecaNaoEncontradaError } from '../../../domain/errors/PecaNaoEncontradaError';
import { OrdemDeServicoRepository } from '../../../domain/repositories/OrdemDeServicoRepository';
import { PecaRepository } from '../../../domain/repositories/PecaRepository';

interface Input {
  id: string;
}

export class RemoverPecaUseCase {
  constructor(
    private readonly pecaRepo: PecaRepository,
    private readonly osRepo: OrdemDeServicoRepository,
  ) {}

  async execute(input: Input): Promise<void> {
    const peca = await this.pecaRepo.findById(input.id);
    if (!peca) throw new PecaNaoEncontradaError();

    const ordens = await this.osRepo.findAll();
    const emUso = ordens.some(
      (os) =>
        os.status !== StatusOS.ENTREGUE &&
        os.itens.some((item) => item.pecaId === input.id),
    );
    if (emUso) throw new EntidadeEmUsoNaoPodeSerRemovidaError();

    peca.desativar();
    await this.pecaRepo.save(peca);
  }
}
