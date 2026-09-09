import { EstoqueInsuficienteError } from '../../domain/errors/EstoqueInsuficienteError';
import { OrdemDeServicoNaoEncontradaError } from '../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { PecaNaoEncontradaError } from '../../domain/errors/PecaNaoEncontradaError';
import { Peca } from '../../domain/entities/Peca';
import { OrdemDeServicoRepository } from '../../domain/repositories/OrdemDeServicoRepository';
import { PecaRepository } from '../../domain/repositories/PecaRepository';
import { ItemOS } from '../../domain/value-objects/ItemOS';

interface Input {
  osId: string;
}

export class IniciarExecucaoUseCase {
  constructor(
    private readonly osRepo: OrdemDeServicoRepository,
    private readonly pecaRepo: PecaRepository,
  ) {}

  async execute(input: Input): Promise<void> {
    const os = await this.osRepo.findById(input.osId);
    if (!os) throw new OrdemDeServicoNaoEncontradaError();

    const pecasPorId = await this.validarEstoqueDisponivel(os.itens);
    await this.baixarEstoqueDasPecas(os.itens, pecasPorId);

    os.iniciarExecucao();
    await this.osRepo.save(os);
  }

  private async validarEstoqueDisponivel(
    itensOS: ItemOS[],
  ): Promise<Map<string, Peca>> {
    const pecasPorId = new Map<string, Peca>();

    for (const itemOS of itensOS) {
      const peca = await this.pecaRepo.findById(itemOS.pecaId);
      if (!peca) throw new PecaNaoEncontradaError();
      if (peca.quantidadeEstoque < itemOS.quantidade.valor) {
        throw new EstoqueInsuficienteError();
      }
      pecasPorId.set(itemOS.pecaId, peca);
    }

    return pecasPorId;
  }

  private async baixarEstoqueDasPecas(
    itensOS: ItemOS[],
    pecasPorId: Map<string, Peca>,
  ): Promise<void> {
    for (const itemOS of itensOS) {
      const peca = pecasPorId.get(itemOS.pecaId);
      if (!peca) throw new PecaNaoEncontradaError();

      peca.baixarEstoque(itemOS.quantidade);
      await this.pecaRepo.save(peca);
    }
  }
}
