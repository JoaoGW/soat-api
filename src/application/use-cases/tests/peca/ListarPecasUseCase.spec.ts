import { ListarPecasUseCase } from '../../peca/ListarPecasUseCase';
import { InMemoryPecaRepository } from '../../fakes/InMemoryPecaRepository';
import { makePeca } from '../_helpers';

describe('ListarPecasUseCase', () => {
  it('deve retornar lista vazia quando nao houver pecas', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new ListarPecasUseCase(repo);

    const result = await useCase.execute();

    expect(result).toEqual([]);
  });

  it('deve listar somente pecas ativas por padrao', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new ListarPecasUseCase(repo);
    const ativa = makePeca('Ativa');
    const inativa = makePeca('Inativa');
    inativa.desativar();
    await repo.save(ativa);
    await repo.save(inativa);

    const result = await useCase.execute();

    expect(result).toHaveLength(1);
    expect(result[0].getId()).toBe(ativa.getId());
  });
});
