import { ClienteNaoEncontradoError } from '../../domain/errors/ClienteNaoEncontradoError';
import { EstoqueInsuficienteError } from '../../domain/errors/EstoqueInsuficienteError';
import { PecaNaoEncontradaError } from '../../domain/errors/PecaNaoEncontradaError';
import { ServicoNaoEncontradoError } from '../../domain/errors/ServicoNaoEncontradoError';
import { VeiculoNaoEncontradoError } from '../../domain/errors/VeiculoNaoEncontradoError';
import { VeiculoNaoPertenceAoClienteError } from '../../domain/errors/VeiculoNaoPertenceAoClienteError';
import { OrdemDeServico } from '../../domain/entities/OrdemDeServico';
import { ClienteRepository } from '../../domain/repositories/ClienteRepository';
import { OrdemDeServicoRepository } from '../../domain/repositories/OrdemDeServicoRepository';
import { PecaRepository } from '../../domain/repositories/PecaRepository';
import { ServicoRepository } from '../../domain/repositories/ServicoRepository';
import { VeiculoRepository } from '../../domain/repositories/VeiculoRepository';
import { Quantidade } from '../../domain/value-objects/Quantidade';

interface Input {
  clienteId: string;
  veiculoId: string;
  servicos?: { servicoId: string }[];
  pecas?: { pecaId: string; quantidade: number }[];
}

interface Output {
  id: string;
  codigoAcompanhamento: string;
  status: string;
  dataCriacao: Date;
}

export class CriarOrdemDeServicoUseCase {
  constructor(
    private readonly osRepo: OrdemDeServicoRepository,
    private readonly clienteRepo: ClienteRepository,
    private readonly veiculoRepo: VeiculoRepository,
    private readonly servicoRepo: ServicoRepository,
    private readonly pecaRepo: PecaRepository,
  ) {}

  async execute(input: Input): Promise<Output> {
    const cliente = await this.clienteRepo.findById(input.clienteId);
    if (!cliente) throw new ClienteNaoEncontradoError();

    const veiculo = await this.veiculoRepo.findById(input.veiculoId);
    if (!veiculo) throw new VeiculoNaoEncontradoError();

    if (veiculo.clienteId !== input.clienteId) {
      throw new VeiculoNaoPertenceAoClienteError();
    }

    const os = OrdemDeServico.criar(input.clienteId, input.veiculoId);
    await this.adicionarServicosIniciais(os, input.servicos ?? []);
    await this.adicionarPecasIniciais(os, input.pecas ?? []);

    await this.osRepo.save(os);

    return {
      id: os.getId(),
      codigoAcompanhamento: os.codigoAcompanhamento.valor,
      status: os.status,
      dataCriacao: os.dataCriacao,
    };
  }

  private async adicionarServicosIniciais(
    os: OrdemDeServico,
    servicos: { servicoId: string }[],
  ): Promise<void> {
    for (const { servicoId } of servicos) {
      const servico = await this.servicoRepo.findById(servicoId);
      if (!servico) throw new ServicoNaoEncontradoError();
      os.adicionarServico(servico.getId(), servico.preco);
    }
  }

  private async adicionarPecasIniciais(
    os: OrdemDeServico,
    pecas: { pecaId: string; quantidade: number }[],
  ): Promise<void> {
    for (const { pecaId, quantidade } of pecas) {
      const peca = await this.pecaRepo.findById(pecaId);
      if (!peca) throw new PecaNaoEncontradaError();

      const quantidadeSolicitada = new Quantidade(quantidade);
      if (peca.quantidadeEstoque < quantidadeSolicitada.valor) {
        throw new EstoqueInsuficienteError();
      }

      os.adicionarPeca(peca.getId(), quantidadeSolicitada, peca.preco);
    }
  }
}
