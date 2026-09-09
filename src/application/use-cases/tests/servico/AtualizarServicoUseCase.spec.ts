import { ServicoNaoEncontradoError } from '../../../../domain/errors/ServicoNaoEncontradoError';
import { CriarServicoUseCase } from '../../servico/CriarServicoUseCase';
import { AtualizarServicoUseCase } from '../../servico/AtualizarServicoUseCase';
import { InMemoryServicoRepository } from '../../fakes/InMemoryServicoRepository';

describe('AtualizarServicoUseCase', () => {
  it('deve falhar quando servico nao existir', async () => {
    const repo = new InMemoryServicoRepository();
    const useCase = new AtualizarServicoUseCase(repo);

    await expect(
      useCase.execute({ id: 'nao-existe', precoEmCentavos: 20000 }),
    ).rejects.toBeInstanceOf(ServicoNaoEncontradoError);
  });

  it('deve atualizar preco', async () => {
    const repo = new InMemoryServicoRepository();
    const criar = new CriarServicoUseCase(repo);
    const atualizar = new AtualizarServicoUseCase(repo);
    const { id } = await criar.execute({
      nome: 'Troca de oleo',
      descricao: 'Descricao',
      precoEmCentavos: 15000,
    });

    await atualizar.execute({ id, precoEmCentavos: 18000 });

    const servico = await repo.findById(id);
    expect(servico?.preco.centavos).toBe(18000);
  });
});
