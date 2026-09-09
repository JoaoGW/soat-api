import { ClienteNaoEncontradoError } from '../../../../domain/errors/ClienteNaoEncontradoError';
import { PlacaJaCadastradaError } from '../../../../domain/errors/PlacaJaCadastradaError';
import { PlacaVeiculoInvalidaError } from '../../../../domain/errors/PlacaVeiculoInvalidaError';
import { CriarClienteUseCase } from '../../cliente/CriarClienteUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';
import { InMemoryVeiculoRepository } from '../../fakes/InMemoryVeiculoRepository';
import { CriarVeiculoUseCase } from '../../veiculo/CriarVeiculoUseCase';

describe('CriarVeiculoUseCase', () => {
  it('deve falhar quando cliente nao existir', async () => {
    const veiculoRepo = new InMemoryVeiculoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const useCase = new CriarVeiculoUseCase(veiculoRepo, clienteRepo);

    await expect(
      useCase.execute({
        clienteId: 'nao-existe',
        placa: 'ABC1D23',
        marca: 'VW',
        modelo: 'Gol',
        ano: 2020,
      }),
    ).rejects.toBeInstanceOf(ClienteNaoEncontradoError);
  });

  it('deve falhar com placa invalida', async () => {
    const veiculoRepo = new InMemoryVeiculoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const criarCliente = new CriarClienteUseCase(clienteRepo);
    const useCase = new CriarVeiculoUseCase(veiculoRepo, clienteRepo);
    const { id: clienteId } = await criarCliente.execute({
      nome: 'Cliente',
      documento: '52998224725',
      contato: 'cliente@test.com',
    });

    await expect(
      useCase.execute({
        clienteId,
        placa: '123',
        marca: 'VW',
        modelo: 'Gol',
        ano: 2020,
      }),
    ).rejects.toBeInstanceOf(PlacaVeiculoInvalidaError);
  });

  it('deve falhar com placa duplicada', async () => {
    const veiculoRepo = new InMemoryVeiculoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const criarCliente = new CriarClienteUseCase(clienteRepo);
    const useCase = new CriarVeiculoUseCase(veiculoRepo, clienteRepo);
    const { id: clienteId } = await criarCliente.execute({
      nome: 'Cliente',
      documento: '52998224725',
      contato: 'cliente@test.com',
    });

    await useCase.execute({
      clienteId,
      placa: 'ABC1D23',
      marca: 'VW',
      modelo: 'Gol',
      ano: 2020,
    });

    await expect(
      useCase.execute({
        clienteId,
        placa: 'ABC1D23',
        marca: 'Fiat',
        modelo: 'Uno',
        ano: 2021,
      }),
    ).rejects.toBeInstanceOf(PlacaJaCadastradaError);
  });

  it('deve criar veiculo valido', async () => {
    const veiculoRepo = new InMemoryVeiculoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const criarCliente = new CriarClienteUseCase(clienteRepo);
    const useCase = new CriarVeiculoUseCase(veiculoRepo, clienteRepo);
    const { id: clienteId } = await criarCliente.execute({
      nome: 'Cliente',
      documento: '52998224725',
      contato: 'cliente@test.com',
    });

    const { id } = await useCase.execute({
      clienteId,
      placa: 'ABC1D23',
      marca: 'VW',
      modelo: 'Gol',
      ano: 2020,
    });

    const veiculo = await veiculoRepo.findById(id);
    expect(veiculo).not.toBeNull();
    expect(veiculo?.placa.valor).toBe('ABC1D23');
  });
});
