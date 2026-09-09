import { ClienteNaoEncontradoError } from '../../../../domain/errors/ClienteNaoEncontradoError';
import { CriarClienteUseCase } from '../../cliente/CriarClienteUseCase';
import { RemoverClienteUseCase } from '../../cliente/RemoverClienteUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';

describe('RemoverClienteUseCase', () => {
  it('deve falhar quando cliente nao existir', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new RemoverClienteUseCase(repo);

    await expect(useCase.execute({ id: 'nao-existe' })).rejects.toBeInstanceOf(
      ClienteNaoEncontradoError,
    );
  });

  it('deve desativar cliente', async () => {
    const repo = new InMemoryClienteRepository();
    const criar = new CriarClienteUseCase(repo);
    const remover = new RemoverClienteUseCase(repo);
    const { id } = await criar.execute({
      nome: 'Cliente',
      documento: '52998224725',
      contato: 'cliente@test.com',
    });

    await remover.execute({ id });

    const cliente = await repo.findById(id);
    expect(cliente?.ativo).toBe(false);
  });
});
