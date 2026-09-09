import { PecaNaoEncontradaError } from '../../../../domain/errors/PecaNaoEncontradaError';
import { BuscarPecaPorIdUseCase } from '../../peca/BuscarPecaPorIdUseCase';
import { InMemoryPecaRepository } from '../../fakes/InMemoryPecaRepository';
import { makePeca } from '../_helpers';

describe('BuscarPecaPorIdUseCase', () => {
  it('deve falhar quando peca nao existe', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new BuscarPecaPorIdUseCase(repo);

    await expect(useCase.execute('inexistente')).rejects.toBeInstanceOf(
      PecaNaoEncontradaError,
    );
  });

  it('deve retornar peca por id', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new BuscarPecaPorIdUseCase(repo);
    const peca = makePeca();
    await repo.save(peca);

    const encontrada = await useCase.execute(peca.getId());

    expect(encontrada.getId()).toBe(peca.getId());
    expect(encontrada.nome).toBe(peca.nome);
  });
});
