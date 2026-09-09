import { ClienteNaoEncontradoError } from '../../../../domain/errors/ClienteNaoEncontradoError';
import { BuscarClientePorIdUseCase } from '../../cliente/BuscarClientePorIdUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';
import { makeCliente } from '../_helpers';

describe('BuscarClientePorIdUseCase', () => {
  it('deve falhar quando cliente nao existe', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new BuscarClientePorIdUseCase(repo);

    await expect(useCase.execute('inexistente')).rejects.toBeInstanceOf(
      ClienteNaoEncontradoError,
    );
  });

  it('deve retornar cliente por id', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new BuscarClientePorIdUseCase(repo);
    const cliente = makeCliente();
    await repo.save(cliente);

    const encontrado = await useCase.execute(cliente.getId());

    expect(encontrado.getId()).toBe(cliente.getId());
    expect(encontrado.nome).toBe(cliente.nome);
  });
});
