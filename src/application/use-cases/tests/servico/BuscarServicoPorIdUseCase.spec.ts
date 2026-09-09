import { ServicoNaoEncontradoError } from '../../../../domain/errors/ServicoNaoEncontradoError';
import { BuscarServicoPorIdUseCase } from '../../servico/BuscarServicoPorIdUseCase';
import { InMemoryServicoRepository } from '../../fakes/InMemoryServicoRepository';
import { makeServico } from '../_helpers';

describe('BuscarServicoPorIdUseCase', () => {
  it('deve falhar quando servico nao existe', async () => {
    const repo = new InMemoryServicoRepository();
    const useCase = new BuscarServicoPorIdUseCase(repo);

    await expect(useCase.execute('inexistente')).rejects.toBeInstanceOf(
      ServicoNaoEncontradoError,
    );
  });

  it('deve retornar servico por id', async () => {
    const repo = new InMemoryServicoRepository();
    const useCase = new BuscarServicoPorIdUseCase(repo);
    const servico = makeServico();
    await repo.save(servico);

    const encontrado = await useCase.execute(servico.getId());

    expect(encontrado.getId()).toBe(servico.getId());
    expect(encontrado.nome).toBe(servico.nome);
  });
});
