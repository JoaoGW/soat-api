import { VeiculoNaoEncontradoError } from '../../../../domain/errors/VeiculoNaoEncontradoError';
import { BuscarVeiculoPorIdUseCase } from '../../veiculo/BuscarVeiculoPorIdUseCase';
import { InMemoryVeiculoRepository } from '../../fakes/InMemoryVeiculoRepository';
import { makeVeiculo } from '../_helpers';

describe('BuscarVeiculoPorIdUseCase', () => {
  it('deve falhar quando veiculo nao existe', async () => {
    const repo = new InMemoryVeiculoRepository();
    const useCase = new BuscarVeiculoPorIdUseCase(repo);

    await expect(useCase.execute('inexistente')).rejects.toBeInstanceOf(
      VeiculoNaoEncontradoError,
    );
  });

  it('deve retornar veiculo por id', async () => {
    const repo = new InMemoryVeiculoRepository();
    const useCase = new BuscarVeiculoPorIdUseCase(repo);
    const veiculo = makeVeiculo('cliente-1');
    await repo.save(veiculo);

    const encontrado = await useCase.execute(veiculo.getId());

    expect(encontrado.getId()).toBe(veiculo.getId());
    expect(encontrado.placa.valor).toBe(veiculo.placa.valor);
  });
});
