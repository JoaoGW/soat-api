import { AtualizarClienteUseCase } from '../../cliente/AtualizarClienteUseCase';
import { CriarClienteUseCase } from '../../cliente/CriarClienteUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';
import { ClienteNaoEncontradoError } from '../../../../domain/errors/ClienteNaoEncontradoError';

describe('AtualizarClienteUseCase', () => {
  it('deve falhar se cliente nao existir', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new AtualizarClienteUseCase(repo);
    await expect(
      useCase.execute({ id: 'nao-existe', nome: 'Novo Nome' }),
    ).rejects.toBeInstanceOf(ClienteNaoEncontradoError);
  });

  it('deve atualizar nome e contato', async () => {
    const repo = new InMemoryClienteRepository();
    const criar = new CriarClienteUseCase(repo);
    const atualizar = new AtualizarClienteUseCase(repo);
    const { id } = await criar.execute({
      nome: 'Nome Antigo',
      documento: '52998224725',
      contato: 'old@test.com',
    });

    await atualizar.execute({ id, nome: 'Nome Novo', contato: 'new@test.com' });
    const cliente = await repo.findById(id);
    expect(cliente?.nome).toBe('Nome Novo');
    expect(cliente?.contato).toBe('new@test.com');
  });

  it('nao atualiza documento por este use case', async () => {
    const repo = new InMemoryClienteRepository();
    const criar = new CriarClienteUseCase(repo);
    const atualizar = new AtualizarClienteUseCase(repo);
    const { id } = await criar.execute({
      nome: 'Nome',
      documento: '52998224725',
      contato: 'old@test.com',
    });

    await atualizar.execute({ id, nome: 'Outro Nome' });
    const cliente = await repo.findById(id);
    expect(cliente?.documento.valor).toBe('52998224725');
  });
});
