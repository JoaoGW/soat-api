import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { CodigoAcompanhamentoInvalidoError } from '../../../domain/errors/CodigoAcompanhamentoInvalidoError';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';
import { ConsultarStatusOSUseCase } from '../ConsultarStatusOSUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';

describe('ConsultarStatusOSUseCase', () => {
  it('deve retornar codigo, status, descricao e dataAtualizacao', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ConsultarStatusOSUseCase(repo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    await repo.save(os);

    const output = await useCase.execute({
      codigoAcompanhamento: os.codigoAcompanhamento.valor,
    });

    expect(output.codigoAcompanhamento).toBe(os.codigoAcompanhamento.valor);
    expect(output.status).toBe('EM_DIAGNOSTICO');
    expect(output.descricaoStatus).toBe('Seu veiculo esta em diagnostico.');
    expect(output.dataAtualizacao).toBeInstanceOf(Date);
  });

  it('deve falhar para OS inexistente', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ConsultarStatusOSUseCase(repo);

    await expect(
      useCase.execute({ codigoAcompanhamento: 'OS-2026-AAAAAA' }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve falhar para codigo invalido', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ConsultarStatusOSUseCase(repo);

    await expect(
      useCase.execute({ codigoAcompanhamento: 'invalido' }),
    ).rejects.toBeInstanceOf(CodigoAcompanhamentoInvalidoError);
  });

  it('deve retornar descricao para OS cancelada', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ConsultarStatusOSUseCase(repo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();
    os.recusarOrcamento();
    await repo.save(os);

    const output = await useCase.execute({
      codigoAcompanhamento: os.codigoAcompanhamento.valor,
    });

    expect(output.status).toBe('CANCELADA');
    expect(output.descricaoStatus).toBe(
      'O orcamento foi recusado e a ordem de servico foi cancelada.',
    );
  });
});
