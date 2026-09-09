import { OrdemDeServicoNaoEncontradaError } from '../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { StatusOS } from '../../domain/enums/StatusOS';
import { OrdemDeServicoRepository } from '../../domain/repositories/OrdemDeServicoRepository';
import { CodigoAcompanhamento } from '../../domain/value-objects/CodigoAcompanhamento';

interface Input {
  codigoAcompanhamento: string;
}

interface Output {
  codigoAcompanhamento: string;
  status: string;
  descricaoStatus: string;
  dataAtualizacao: Date;
}

export class ConsultarStatusOSUseCase {
  constructor(private readonly repo: OrdemDeServicoRepository) {}

  async execute(input: Input): Promise<Output> {
    const codigo = CodigoAcompanhamento.criar(input.codigoAcompanhamento);
    const os = await this.repo.findByCodigoAcompanhamento(codigo.valor);
    if (!os) throw new OrdemDeServicoNaoEncontradaError();

    return {
      codigoAcompanhamento: os.codigoAcompanhamento.valor,
      status: os.status,
      descricaoStatus: this.descreverStatus(os.status),
      dataAtualizacao: os.dataAtualizacao,
    };
  }

  private descreverStatus(status: StatusOS): string {
    const descricoes: Record<StatusOS, string> = {
      [StatusOS.RECEBIDA]: 'Sua ordem de servico foi recebida pela oficina.',
      [StatusOS.EM_DIAGNOSTICO]: 'Seu veiculo esta em diagnostico.',
      [StatusOS.AGUARDANDO_APROVACAO]: 'O orcamento esta aguardando aprovacao.',
      [StatusOS.EM_EXECUCAO]: 'Seu veiculo esta em execucao de servico.',
      [StatusOS.FINALIZADA]:
        'O servico foi finalizado e o veiculo esta aguardando entrega.',
      [StatusOS.ENTREGUE]: 'O veiculo foi entregue ao cliente.',
      [StatusOS.CANCELADA]:
        'O orcamento foi recusado e a ordem de servico foi cancelada.',
    };

    return descricoes[status];
  }
}
