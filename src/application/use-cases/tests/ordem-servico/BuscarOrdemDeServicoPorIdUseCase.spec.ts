import { OrdemDeServico } from '../../../../domain/entities/OrdemDeServico';
import { OrdemDeServicoNaoEncontradaError } from '../../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { InMemoryOrdemDeServicoRepository } from '../../fakes/InMemoryOrdemDeServicoRepository';
import { BuscarOrdemDeServicoPorIdUseCase } from '../../ordem-servico/BuscarOrdemDeServicoPorIdUseCase';

describe('BuscarOrdemDeServicoPorIdUseCase', () => {
  it('deve falhar quando OS nao existir', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new BuscarOrdemDeServicoPorIdUseCase(repo);

    await expect(useCase.execute('nao-existe')).rejects.toBeInstanceOf(
      OrdemDeServicoNaoEncontradaError,
    );
  });

  it('deve buscar OS por id', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new BuscarOrdemDeServicoPorIdUseCase(repo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await repo.save(os);

    const found = await useCase.execute(os.getId());
    expect(found.getId()).toBe(os.getId());
  });
});
