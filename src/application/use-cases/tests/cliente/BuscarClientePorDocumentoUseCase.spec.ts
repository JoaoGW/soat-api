import { BuscarClientePorDocumentoUseCase } from '../../cliente/BuscarClientePorDocumentoUseCase';
import { CriarClienteUseCase } from '../../cliente/CriarClienteUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';
import { DocumentoInvalidoError } from '../../../../domain/errors/DocumentoInvalidoError';
import { ClienteNaoEncontradoError } from '../../../../domain/errors/ClienteNaoEncontradoError';

describe('BuscarClientePorDocumentoUseCase', () => {
  it('deve falhar para documento invalido', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new BuscarClientePorDocumentoUseCase(repo);
    await expect(useCase.execute('1')).rejects.toBeInstanceOf(
      DocumentoInvalidoError,
    );
  });

  it('deve falhar quando cliente nao existir', async () => {
    const repo = new InMemoryClienteRepository();
    const useCase = new BuscarClientePorDocumentoUseCase(repo);
    await expect(useCase.execute('52998224725')).rejects.toBeInstanceOf(
      ClienteNaoEncontradoError,
    );
  });

  it('deve buscar cliente valido por documento', async () => {
    const repo = new InMemoryClienteRepository();
    const criar = new CriarClienteUseCase(repo);
    const buscar = new BuscarClientePorDocumentoUseCase(repo);
    await criar.execute({
      nome: 'Cliente',
      documento: '52998224725',
      contato: 'x@test.com',
    });

    const cliente = await buscar.execute('52998224725');
    expect(cliente.nome).toBe('Cliente');
  });
});
