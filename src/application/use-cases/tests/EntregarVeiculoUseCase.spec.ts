import { EntregarVeiculoUseCase } from '../EntregarVeiculoUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { TransicaoStatusInvalidaError } from '../../../domain/errors/TransicaoStatusInvalidaError';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';

describe('EntregarVeiculoUseCase', () => {
  it('deve falhar se OS nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new EntregarVeiculoUseCase(osRepo);

    await expect(
      useCase.execute({ osId: 'os-inexistente' }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve falhar se OS estiver fora de FINALIZADA', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new EntregarVeiculoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      TransicaoStatusInvalidaError,
    );
  });

  it('deve entregar veiculo com sucesso', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new EntregarVeiculoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();
    os.aprovarOrcamento();
    os.iniciarExecucao();
    os.finalizarServico();
    await osRepo.save(os);

    await useCase.execute({ osId: os.getId() });

    const saved = await osRepo.findById(os.getId());
    expect(saved?.status).toBe('ENTREGUE');
  });
});
