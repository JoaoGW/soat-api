import { OrdemDeServico } from '../../../../domain/entities/OrdemDeServico';
import { EntidadeEmUsoNaoPodeSerRemovidaError } from '../../../../domain/errors/EntidadeEmUsoNaoPodeSerRemovidaError';
import { PecaNaoEncontradaError } from '../../../../domain/errors/PecaNaoEncontradaError';
import { Dinheiro } from '../../../../domain/value-objects/Dinheiro';
import { Quantidade } from '../../../../domain/value-objects/Quantidade';
import { InMemoryOrdemDeServicoRepository } from '../../fakes/InMemoryOrdemDeServicoRepository';
import { InMemoryPecaRepository } from '../../fakes/InMemoryPecaRepository';
import { CriarPecaUseCase } from '../../peca/CriarPecaUseCase';
import { RemoverPecaUseCase } from '../../peca/RemoverPecaUseCase';

describe('RemoverPecaUseCase', () => {
  it('deve falhar quando peca nao existir', async () => {
    const pecaRepo = new InMemoryPecaRepository();
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new RemoverPecaUseCase(pecaRepo, osRepo);

    await expect(useCase.execute({ id: 'nao-existe' })).rejects.toBeInstanceOf(
      PecaNaoEncontradaError,
    );
  });

  it('deve falhar quando peca estiver em uso por OS ativa', async () => {
    const pecaRepo = new InMemoryPecaRepository();
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const criar = new CriarPecaUseCase(pecaRepo);
    const remover = new RemoverPecaUseCase(pecaRepo, osRepo);
    const { id } = await criar.execute({
      nome: 'Filtro',
      precoEmCentavos: 4500,
      quantidadeEstoque: 10,
    });
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarPeca(id, new Quantidade(2), new Dinheiro(4500));
    await osRepo.save(os);

    await expect(remover.execute({ id })).rejects.toBeInstanceOf(
      EntidadeEmUsoNaoPodeSerRemovidaError,
    );
  });

  it('deve desativar peca quando nao estiver em uso', async () => {
    const pecaRepo = new InMemoryPecaRepository();
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const criar = new CriarPecaUseCase(pecaRepo);
    const remover = new RemoverPecaUseCase(pecaRepo, osRepo);
    const { id } = await criar.execute({
      nome: 'Filtro',
      precoEmCentavos: 4500,
      quantidadeEstoque: 10,
    });

    await remover.execute({ id });

    const peca = await pecaRepo.findById(id);
    expect(peca?.ativo).toBe(false);
  });
});
