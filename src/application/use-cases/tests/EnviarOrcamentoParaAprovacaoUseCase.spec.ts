import { EnviarOrcamentoParaAprovacaoUseCase } from '../EnviarOrcamentoParaAprovacaoUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { OrcamentoNaoGeradoError } from '../../../domain/errors/OrcamentoNaoGeradoError';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';
import { InMemoryClienteRepository } from '../fakes/InMemoryClienteRepository';
import { NotificacaoPort } from '../../ports/output/NotificacaoPort';
import {
  OrcamentoWebhookTokenPayload,
  OrcamentoWebhookTokenPort,
} from '../../ports/output/OrcamentoWebhookTokenPort';
import { Cliente } from '../../../domain/entities/Cliente';
import { Documento } from '../../../domain/value-objects/Documento';
import { ClienteNaoEncontradoError } from '../../../domain/errors/ClienteNaoEncontradoError';

class FakeNotificacaoPort implements NotificacaoPort {
  chamadas: Parameters<NotificacaoPort['enviarNotificacaoOrcamento']>[0][] = [];

  async enviarNotificacaoOrcamento(
    params: Parameters<NotificacaoPort['enviarNotificacaoOrcamento']>[0],
  ): Promise<void> {
    this.chamadas.push(params);
  }
}

class FakeOrcamentoWebhookTokenPort implements OrcamentoWebhookTokenPort {
  async gerarToken(payload: OrcamentoWebhookTokenPayload): Promise<string> {
    return `token-${payload.acao}-${payload.osId}`;
  }

  async validarToken(): Promise<OrcamentoWebhookTokenPayload> {
    throw new Error('Nao usado neste teste');
  }
}

describe('EnviarOrcamentoParaAprovacaoUseCase', () => {
  function makeSut() {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const notificacao = new FakeNotificacaoPort();
    const webhookTokens = new FakeOrcamentoWebhookTokenPort();
    const useCase = new EnviarOrcamentoParaAprovacaoUseCase(
      osRepo,
      clienteRepo,
      notificacao,
      webhookTokens,
    );

    return { osRepo, clienteRepo, notificacao, useCase };
  }

  function makeCliente(clienteId: string): Cliente {
    return new Cliente(
      {
        nome: 'Cliente Email',
        documento: new Documento('52998224725'),
        tipo: 'PF',
        contato: 'cliente@email.com',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      },
      { toString: () => clienteId } as any,
    );
  }

  it('deve falhar se OS nao existir', async () => {
    const { useCase } = makeSut();

    await expect(
      useCase.execute({ osId: 'os-inexistente' }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve falhar se orcamento nao tiver sido gerado', async () => {
    const { osRepo, clienteRepo, useCase } = makeSut();
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(12000));
    await osRepo.save(os);
    await clienteRepo.save(makeCliente('cliente-1'));

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      OrcamentoNaoGeradoError,
    );
  });

  it('deve falhar se cliente da OS nao existir', async () => {
    const { osRepo, useCase } = makeSut();
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(12000));
    os.gerarOrcamento();
    await osRepo.save(os);

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      ClienteNaoEncontradoError,
    );
  });

  it('deve enviar orcamento para aprovacao com sucesso', async () => {
    const { osRepo, clienteRepo, notificacao, useCase } = makeSut();
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(12000));
    os.gerarOrcamento();
    await osRepo.save(os);
    await clienteRepo.save(makeCliente('cliente-1'));

    await useCase.execute({ osId: os.getId() });

    const saved = await osRepo.findById(os.getId());
    expect(saved?.status).toBe('AGUARDANDO_APROVACAO');
    expect(notificacao.chamadas).toHaveLength(1);
    expect(notificacao.chamadas[0]).toEqual({
      destinatario: 'cliente@email.com',
      osId: os.getId(),
      codigoAcompanhamento: os.codigoAcompanhamento.valor,
      tokenAprovacao: `token-aprovar-${os.getId()}`,
      tokenRecusa: `token-recusar-${os.getId()}`,
    });
  });
});
