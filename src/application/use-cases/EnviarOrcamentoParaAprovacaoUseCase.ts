import { ClienteNaoEncontradoError } from '../../domain/errors/ClienteNaoEncontradoError';
import { OrdemDeServicoNaoEncontradaError } from '../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { ClienteRepository } from '../../domain/repositories/ClienteRepository';
import { OrdemDeServicoRepository } from '../../domain/repositories/OrdemDeServicoRepository';
import { NotificacaoPort } from '../ports/output/NotificacaoPort';
import { OrcamentoWebhookTokenPort } from '../ports/output/OrcamentoWebhookTokenPort';

interface Input {
  osId: string;
}

export class EnviarOrcamentoParaAprovacaoUseCase {
  constructor(
    private readonly osRepo: OrdemDeServicoRepository,
    private readonly clienteRepo: ClienteRepository,
    private readonly notificacao: NotificacaoPort,
    private readonly webhookTokens: OrcamentoWebhookTokenPort,
  ) {}

  async execute(input: Input): Promise<void> {
    const os = await this.osRepo.findById(input.osId);
    if (!os) throw new OrdemDeServicoNaoEncontradaError();

    const cliente = await this.clienteRepo.findById(os.clienteId);
    if (!cliente) throw new ClienteNaoEncontradoError();

    os.enviarOrcamentoParaAprovacao();
    await this.osRepo.save(os);

    const tokenAprovacao = await this.webhookTokens.gerarToken({
      osId: os.getId(),
      acao: 'aprovar',
    });
    const tokenRecusa = await this.webhookTokens.gerarToken({
      osId: os.getId(),
      acao: 'recusar',
    });

    await this.notificacao.enviarNotificacaoOrcamento({
      destinatario: cliente.contato,
      osId: os.getId(),
      codigoAcompanhamento: os.codigoAcompanhamento.valor,
      tokenAprovacao,
      tokenRecusa,
    });
  }
}
