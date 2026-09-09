import { CriarClienteUseCase } from '../../cliente/CriarClienteUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';
import { DocumentoInvalidoError } from '../../../../domain/errors/DocumentoInvalidoError';
import { DocumentoJaCadastradoError } from '../../../../domain/errors/DocumentoJaCadastradoError';

describe('CriarClienteUseCase', () => {
  it('deve falhar para documento invalido', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new CriarClienteUseCase(repo);

    await expect(
      useCase.execute({
        nome: 'Cliente',
        documento: '123',
        contato: 'email@test.com',
      }),
    ).rejects.toBeInstanceOf(DocumentoInvalidoError);
  });

  it('deve falhar para documento duplicado', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new CriarClienteUseCase(repo);
    await useCase.execute({
      nome: 'Cliente 1',
      documento: '52998224725',
      contato: 'a@test.com',
    });

    await expect(
      useCase.execute({
        nome: 'Cliente 2',
        documento: '52998224725',
        contato: 'b@test.com',
      }),
    ).rejects.toBeInstanceOf(DocumentoJaCadastradoError);
  });

  it('deve criar cliente PF valido', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new CriarClienteUseCase(repo);
    const output = await useCase.execute({
      nome: 'PF',
      documento: '52998224725',
      contato: 'pf@test.com',
    });

    const cliente = await repo.findById(output.id);
    expect(cliente?.tipo).toBe('PF');
  });

  it('deve criar cliente PJ valido', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new CriarClienteUseCase(repo);
    const output = await useCase.execute({
      nome: 'PJ',
      documento: '04252011000110',
      contato: 'pj@test.com',
    });

    const cliente = await repo.findById(output.id);
    expect(cliente?.tipo).toBe('PJ');
  });
});
