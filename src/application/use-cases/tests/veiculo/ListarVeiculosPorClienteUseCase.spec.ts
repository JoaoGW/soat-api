import { ListarVeiculosPorClienteUseCase } from '../../veiculo/ListarVeiculosPorClienteUseCase';
import { InMemoryVeiculoRepository } from '../../fakes/InMemoryVeiculoRepository';
import { makeVeiculo } from '../_helpers';

describe('ListarVeiculosPorClienteUseCase', () => {
  it('deve retornar vazio quando cliente nao tiver veiculos', async () => {
    const repo = new InMemoryVeiculoRepository();
    const useCase = new ListarVeiculosPorClienteUseCase(repo);

    const result = await useCase.execute({ clienteId: 'cliente-1' });

    expect(result).toEqual([]);
  });

  it('deve listar somente veiculos do cliente informado', async () => {
    const repo = new InMemoryVeiculoRepository();
    const useCase = new ListarVeiculosPorClienteUseCase(repo);
    const v1 = makeVeiculo('cliente-1');
    const v2 = makeVeiculo('cliente-2');
    await repo.save(v1);
    await repo.save(v2);

    const result = await useCase.execute({ clienteId: 'cliente-1' });

    expect(result).toHaveLength(1);
    expect(result[0].getId()).toBe(v1.getId());
  });
});
