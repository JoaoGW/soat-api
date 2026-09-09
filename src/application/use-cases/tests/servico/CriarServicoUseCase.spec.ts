import { ValorMonetarioInvalidoError } from '../../../../domain/errors/ValorMonetarioInvalidoError';
import { CriarServicoUseCase } from '../../servico/CriarServicoUseCase';
import { InMemoryServicoRepository } from '../../fakes/InMemoryServicoRepository';

describe('CriarServicoUseCase', () => {
  it('deve falhar para preco negativo', async () => {
    const repo = new InMemoryServicoRepository();
    const useCase = new CriarServicoUseCase(repo);

    await expect(
      useCase.execute({
        nome: 'Troca de oleo',
        descricao: 'Descricao',
        precoEmCentavos: -1,
      }),
    ).rejects.toBeInstanceOf(ValorMonetarioInvalidoError);
  });

  it('deve criar servico valido', async () => {
    const repo = new InMemoryServicoRepository();
    const useCase = new CriarServicoUseCase(repo);
    const { id } = await useCase.execute({
      nome: 'Troca de oleo',
      descricao: 'Descricao',
      precoEmCentavos: 15000,
    });

    const servico = await repo.findById(id);
    expect(servico).not.toBeNull();
    expect(servico?.preco.centavos).toBe(15000);
  });
});
