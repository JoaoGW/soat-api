import { PecaNaoEncontradaError } from '../../../../domain/errors/PecaNaoEncontradaError';
import { QuantidadeEstoqueInvalidaError } from '../../../../domain/errors/QuantidadeEstoqueInvalidaError';
import { InMemoryPecaRepository } from '../../fakes/InMemoryPecaRepository';
import { AjustarEstoqueUseCase } from '../../peca/AjustarEstoqueUseCase';
import { CriarPecaUseCase } from '../../peca/CriarPecaUseCase';

describe('AjustarEstoqueUseCase', () => {
  it('deve falhar quando peca nao existir', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new AjustarEstoqueUseCase(repo);

    await expect(
      useCase.execute({ pecaId: 'nao-existe', novaQuantidade: 10 }),
    ).rejects.toBeInstanceOf(PecaNaoEncontradaError);
  });

  it('deve aceitar ajuste para estoque zero', async () => {
    const repo = new InMemoryPecaRepository();
    const criar = new CriarPecaUseCase(repo);
    const ajustar = new AjustarEstoqueUseCase(repo);
    const { id } = await criar.execute({
      nome: 'Filtro',
      precoEmCentavos: 4500,
      quantidadeEstoque: 10,
    });

    await ajustar.execute({ pecaId: id, novaQuantidade: 0 });

    const peca = await repo.findById(id);
    expect(peca?.quantidadeEstoque).toBe(0);
  });

  it('deve falhar com estoque negativo', async () => {
    const repo = new InMemoryPecaRepository();
    const criar = new CriarPecaUseCase(repo);
    const ajustar = new AjustarEstoqueUseCase(repo);
    const { id } = await criar.execute({
      nome: 'Filtro',
      precoEmCentavos: 4500,
      quantidadeEstoque: 10,
    });

    await expect(
      ajustar.execute({ pecaId: id, novaQuantidade: -1 }),
    ).rejects.toBeInstanceOf(QuantidadeEstoqueInvalidaError);
  });

  it('deve ajustar estoque para quantidade valida', async () => {
    const repo = new InMemoryPecaRepository();
    const criar = new CriarPecaUseCase(repo);
    const ajustar = new AjustarEstoqueUseCase(repo);
    const { id } = await criar.execute({
      nome: 'Filtro',
      precoEmCentavos: 4500,
      quantidadeEstoque: 10,
    });

    await ajustar.execute({ pecaId: id, novaQuantidade: 20 });

    const peca = await repo.findById(id);
    expect(peca?.quantidadeEstoque).toBe(20);
  });
});
