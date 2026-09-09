import { PecaNaoEncontradaError } from '../../../../domain/errors/PecaNaoEncontradaError';
import { InMemoryPecaRepository } from '../../fakes/InMemoryPecaRepository';
import { AtualizarPecaUseCase } from '../../peca/AtualizarPecaUseCase';
import { CriarPecaUseCase } from '../../peca/CriarPecaUseCase';

describe('AtualizarPecaUseCase', () => {
  it('deve falhar quando peca nao existir', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new AtualizarPecaUseCase(repo);

    await expect(
      useCase.execute({ id: 'nao-existe', precoEmCentavos: 5000 }),
    ).rejects.toBeInstanceOf(PecaNaoEncontradaError);
  });

  it('deve atualizar preco da peca', async () => {
    const repo = new InMemoryPecaRepository();
    const criar = new CriarPecaUseCase(repo);
    const atualizar = new AtualizarPecaUseCase(repo);
    const { id } = await criar.execute({
      nome: 'Filtro',
      precoEmCentavos: 4500,
      quantidadeEstoque: 10,
    });

    await atualizar.execute({ id, precoEmCentavos: 5500 });

    const peca = await repo.findById(id);
    expect(peca?.preco.centavos).toBe(5500);
  });
});
