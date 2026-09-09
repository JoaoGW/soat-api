import { ListarServicosUseCase } from '../../servico/ListarServicosUseCase';
import { InMemoryServicoRepository } from '../../fakes/InMemoryServicoRepository';
import { makeServico } from '../_helpers';

describe('ListarServicosUseCase', () => {
  it('deve retornar lista vazia quando nao houver servicos', async () => {
    const repo = new InMemoryServicoRepository();
    const useCase = new ListarServicosUseCase(repo);

    const result = await useCase.execute();

    expect(result).toEqual([]);
  });

  it('deve listar somente servicos ativos por padrao', async () => {
    const repo = new InMemoryServicoRepository();
    const useCase = new ListarServicosUseCase(repo);
    const ativo = makeServico('Ativo');
    const inativo = makeServico('Inativo');
    inativo.desativar();
    await repo.save(ativo);
    await repo.save(inativo);

    const result = await useCase.execute();

    expect(result).toHaveLength(1);
    expect(result[0].getId()).toBe(ativo.getId());
  });
});
