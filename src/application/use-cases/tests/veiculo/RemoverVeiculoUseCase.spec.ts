import { VeiculoNaoEncontradoError } from '../../../../domain/errors/VeiculoNaoEncontradoError';
import { CriarClienteUseCase } from '../../cliente/CriarClienteUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';
import { InMemoryVeiculoRepository } from '../../fakes/InMemoryVeiculoRepository';
import { CriarVeiculoUseCase } from '../../veiculo/CriarVeiculoUseCase';
import { RemoverVeiculoUseCase } from '../../veiculo/RemoverVeiculoUseCase';

describe('RemoverVeiculoUseCase', () => {
  it('deve falhar quando veiculo nao existir', async () => {
    const repo = new InMemoryVeiculoRepository();
    const useCase = new RemoverVeiculoUseCase(repo);

    await expect(useCase.execute({ id: 'nao-existe' })).rejects.toBeInstanceOf(
      VeiculoNaoEncontradoError,
    );
  });

  it('deve desativar veiculo', async () => {
    const veiculoRepo = new InMemoryVeiculoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const criarCliente = new CriarClienteUseCase(clienteRepo);
    const criarVeiculo = new CriarVeiculoUseCase(veiculoRepo, clienteRepo);
    const remover = new RemoverVeiculoUseCase(veiculoRepo);
    const { id: clienteId } = await criarCliente.execute({
      nome: 'Cliente',
      documento: '52998224725',
      contato: 'cliente@test.com',
    });
    const { id } = await criarVeiculo.execute({
      clienteId,
      placa: 'ABC1D23',
      marca: 'VW',
      modelo: 'Gol',
      ano: 2020,
    });

    await remover.execute({ id });

    const veiculo = await veiculoRepo.findById(id);
    expect(veiculo?.ativo).toBe(false);
  });
});
