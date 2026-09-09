import { EstoqueInsuficienteError } from '../../domain/errors/EstoqueInsuficienteError';
import { OrdemDeServicoNaoEncontradaError } from '../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { PecaNaoEncontradaError } from '../../domain/errors/PecaNaoEncontradaError';
import { OrdemDeServicoRepository } from '../../domain/repositories/OrdemDeServicoRepository';
import { PecaRepository } from '../../domain/repositories/PecaRepository';
import { Quantidade } from '../../domain/value-objects/Quantidade';

interface Input {
  osId: string;
  pecaId: string;
  quantidade: number;
}

export class AdicionarPecaOSUseCase {
  constructor(
    private readonly osRepo: OrdemDeServicoRepository,
    private readonly pecaRepo: PecaRepository,
  ) {}

  async execute(input: Input): Promise<void> {
    const os = await this.osRepo.findById(input.osId);
    if (!os) throw new OrdemDeServicoNaoEncontradaError();

    const peca = await this.pecaRepo.findById(input.pecaId);
    if (!peca) throw new PecaNaoEncontradaError();

    const quantidade = new Quantidade(input.quantidade);
    if (peca.quantidadeEstoque < quantidade.valor) {
      throw new EstoqueInsuficienteError();
    }

    os.adicionarPeca(peca.getId(), quantidade, peca.preco);
    await this.osRepo.save(os);
  }
}
