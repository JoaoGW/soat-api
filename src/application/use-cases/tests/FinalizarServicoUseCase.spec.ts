import { FinalizarServicoUseCase } from '../FinalizarServicoUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { TransicaoStatusInvalidaError } from '../../../domain/errors/TransicaoStatusInvalidaError';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';

describe('FinalizarServicoUseCase', () => {
  it('deve falhar se OS nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new FinalizarServicoUseCase(osRepo);

    await expect(
      useCase.execute({ osId: 'os-inexistente' }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve falhar se OS estiver fora de EM_EXECUCAO', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new FinalizarServicoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      TransicaoStatusInvalidaError,
    );
  });

  it('deve finalizar servico e preencher dataFinalizacao', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new FinalizarServicoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();
    os.aprovarOrcamento();
    os.iniciarExecucao();
    await osRepo.save(os);

    await useCase.execute({ osId: os.getId() });

    const saved = await osRepo.findById(os.getId());
    expect(saved?.status).toBe('FINALIZADA');
    expect(saved?.dataFinalizacao).toBeInstanceOf(Date);
  });
});
