import { QuantidadeEstoqueInvalidaError } from '../../../../domain/errors/QuantidadeEstoqueInvalidaError';
import { ValorMonetarioInvalidoError } from '../../../../domain/errors/ValorMonetarioInvalidoError';
import { CriarPecaUseCase } from '../../peca/CriarPecaUseCase';
import { InMemoryPecaRepository } from '../../fakes/InMemoryPecaRepository';

describe('CriarPecaUseCase', () => {
  it('deve aceitar estoque inicial zero', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new CriarPecaUseCase(repo);
    const { id } = await useCase.execute({
      nome: 'Filtro',
      precoEmCentavos: 4500,
      quantidadeEstoque: 0,
    });

    const peca = await repo.findById(id);
    expect(peca?.quantidadeEstoque).toBe(0);
  });

  it('deve falhar com estoque negativo', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new CriarPecaUseCase(repo);

    await expect(
      useCase.execute({
        nome: 'Filtro',
        precoEmCentavos: 4500,
        quantidadeEstoque: -1,
      }),
    ).rejects.toBeInstanceOf(QuantidadeEstoqueInvalidaError);
  });

  it('deve falhar com preco negativo', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new CriarPecaUseCase(repo);

    await expect(
      useCase.execute({
        nome: 'Filtro',
        precoEmCentavos: -1,
        quantidadeEstoque: 10,
      }),
    ).rejects.toBeInstanceOf(ValorMonetarioInvalidoError);
  });

  it('deve criar peca valida', async () => {
    const repo = new InMemoryPecaRepository();
    const useCase = new CriarPecaUseCase(repo);
    const { id } = await useCase.execute({
      nome: 'Filtro',
      precoEmCentavos: 4500,
      quantidadeEstoque: 10,
    });

    const peca = await repo.findById(id);
    expect(peca).not.toBeNull();
    expect(peca?.preco.centavos).toBe(4500);
  });
});
