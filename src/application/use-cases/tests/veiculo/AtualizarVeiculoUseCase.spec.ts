import { VeiculoNaoEncontradoError } from '../../../../domain/errors/VeiculoNaoEncontradoError';
import { CriarClienteUseCase } from '../../cliente/CriarClienteUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';
import { InMemoryVeiculoRepository } from '../../fakes/InMemoryVeiculoRepository';
import { AtualizarVeiculoUseCase } from '../../veiculo/AtualizarVeiculoUseCase';
import { CriarVeiculoUseCase } from '../../veiculo/CriarVeiculoUseCase';

describe('AtualizarVeiculoUseCase', () => {
  it('deve falhar quando veiculo nao existir', async () => {
    const repo = new InMemoryVeiculoRepository();
    const useCase = new AtualizarVeiculoUseCase(repo);

    await expect(
      useCase.execute({ id: 'nao-existe', marca: 'Ford' }),
    ).rejects.toBeInstanceOf(VeiculoNaoEncontradoError);
  });

  it('deve atualizar campos permitidos', async () => {
    const veiculoRepo = new InMemoryVeiculoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const criarCliente = new CriarClienteUseCase(clienteRepo);
    const criarVeiculo = new CriarVeiculoUseCase(veiculoRepo, clienteRepo);
    const atualizar = new AtualizarVeiculoUseCase(veiculoRepo);
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

    await atualizar.execute({
      id,
      marca: 'Toyota',
      modelo: 'Corolla',
      ano: 2023,
    });

    const veiculo = await veiculoRepo.findById(id);
    expect(veiculo?.marca).toBe('Toyota');
    expect(veiculo?.modelo).toBe('Corolla');
    expect(veiculo?.ano).toBe(2023);
  });

  it('nao altera placa no use case de atualizacao', async () => {
    const veiculoRepo = new InMemoryVeiculoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const criarCliente = new CriarClienteUseCase(clienteRepo);
    const criarVeiculo = new CriarVeiculoUseCase(veiculoRepo, clienteRepo);
    const atualizar = new AtualizarVeiculoUseCase(veiculoRepo);
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

    await atualizar.execute({ id, modelo: 'Polo' });

    const veiculo = await veiculoRepo.findById(id);
    expect(veiculo?.placa.valor).toBe('ABC1D23');
  });
});
