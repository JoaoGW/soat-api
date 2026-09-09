import { ListarVeiculosUseCase } from '../../veiculo/ListarVeiculosUseCase';
import { InMemoryVeiculoRepository } from '../../fakes/InMemoryVeiculoRepository';
import { makeVeiculo } from '../_helpers';

describe('ListarVeiculosUseCase', () => {
  it('deve retornar lista vazia quando nao houver veiculos', async () => {
    const repo = new InMemoryVeiculoRepository();
    const useCase = new ListarVeiculosUseCase(repo);

    const result = await useCase.execute();

    expect(result).toEqual([]);
  });

  it('deve listar apenas veiculos ativos por padrao', async () => {
    const repo = new InMemoryVeiculoRepository();
    const useCase = new ListarVeiculosUseCase(repo);
    const ativo = makeVeiculo('cliente-1');
    const inativo = makeVeiculo('cliente-2');
    inativo.desativar();
    await repo.save(ativo);
    await repo.save(inativo);

    const result = await useCase.execute();

    expect(result).toHaveLength(1);
    expect(result[0].getId()).toBe(ativo.getId());
  });
});
