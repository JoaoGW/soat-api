import { AdicionarPecaOSUseCase } from '../AdicionarPecaOSUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { InMemoryPecaRepository } from '../fakes/InMemoryPecaRepository';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { PecaNaoEncontradaError } from '../../../domain/errors/PecaNaoEncontradaError';
import { EstoqueInsuficienteError } from '../../../domain/errors/EstoqueInsuficienteError';
import { QuantidadeInvalidaError } from '../../../domain/errors/QuantidadeInvalidaError';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { makePeca } from './_helpers';

describe('AdicionarPecaOSUseCase', () => {
  it('deve falhar se OS nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new AdicionarPecaOSUseCase(osRepo, pecaRepo);

    const peca = makePeca();
    await pecaRepo.save(peca);

    await expect(
      useCase.execute({
        osId: 'os-inexistente',
        pecaId: peca.getId(),
        quantidade: 1,
      }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve falhar se peca nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new AdicionarPecaOSUseCase(osRepo, pecaRepo);

    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);

    await expect(
      useCase.execute({
        osId: os.getId(),
        pecaId: 'peca-inexistente',
        quantidade: 1,
      }),
    ).rejects.toBeInstanceOf(PecaNaoEncontradaError);
  });

  it('deve falhar se estoque for insuficiente', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new AdicionarPecaOSUseCase(osRepo, pecaRepo);

    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);
    const peca = makePeca('Filtro', 3000, 1);
    await pecaRepo.save(peca);

    await expect(
      useCase.execute({
        osId: os.getId(),
        pecaId: peca.getId(),
        quantidade: 2,
      }),
    ).rejects.toBeInstanceOf(EstoqueInsuficienteError);
  });

  it('deve falhar para quantidade invalida', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new AdicionarPecaOSUseCase(osRepo, pecaRepo);

    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);
    const peca = makePeca('Filtro', 3000, 10);
    await pecaRepo.save(peca);

    await expect(
      useCase.execute({
        osId: os.getId(),
        pecaId: peca.getId(),
        quantidade: 0,
      }),
    ).rejects.toBeInstanceOf(QuantidadeInvalidaError);
  });

  it('deve adicionar peca com quantidade e preco preservados', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new AdicionarPecaOSUseCase(osRepo, pecaRepo);

    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);
    const peca = makePeca('Filtro', 4500, 10);
    await pecaRepo.save(peca);

    await useCase.execute({
      osId: os.getId(),
      pecaId: peca.getId(),
      quantidade: 3,
    });

    const saved = await osRepo.findById(os.getId());
    expect(saved?.itens).toHaveLength(1);
    expect(saved?.itens[0].pecaId).toBe(peca.getId());
    expect(saved?.itens[0].quantidade.valor).toBe(3);
    expect(saved?.itens[0].precoUnitario.centavos).toBe(4500);
  });
});
