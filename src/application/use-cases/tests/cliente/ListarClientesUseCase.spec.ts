import { ListarClientesUseCase } from '../../cliente/ListarClientesUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';
import { makeCliente } from '../_helpers';

describe('ListarClientesUseCase', () => {
  it('deve retornar lista vazia quando nao houver clientes', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new ListarClientesUseCase(repo);

    const result = await useCase.execute();

    expect(result).toEqual([]);
  });

  it('deve listar apenas clientes ativos por padrao', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new ListarClientesUseCase(repo);
    const ativo = makeCliente();
    const inativo = makeCliente();
    inativo.desativar();
    await repo.save(ativo);
    await repo.save(inativo);

    const result = await useCase.execute();

    expect(result).toHaveLength(1);
    expect(result[0].getId()).toBe(ativo.getId());
  });
});
