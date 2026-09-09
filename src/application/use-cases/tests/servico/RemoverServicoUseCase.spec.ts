import { OrdemDeServico } from '../../../../domain/entities/OrdemDeServico';
import { EntidadeEmUsoNaoPodeSerRemovidaError } from '../../../../domain/errors/EntidadeEmUsoNaoPodeSerRemovidaError';
import { ServicoNaoEncontradoError } from '../../../../domain/errors/ServicoNaoEncontradoError';
import { Dinheiro } from '../../../../domain/value-objects/Dinheiro';
import { InMemoryOrdemDeServicoRepository } from '../../fakes/InMemoryOrdemDeServicoRepository';
import { InMemoryServicoRepository } from '../../fakes/InMemoryServicoRepository';
import { CriarServicoUseCase } from '../../servico/CriarServicoUseCase';
import { RemoverServicoUseCase } from '../../servico/RemoverServicoUseCase';

describe('RemoverServicoUseCase', () => {
  it('deve falhar quando servico nao existir', async () => {
    const servicoRepo = new InMemoryServicoRepository();
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new RemoverServicoUseCase(servicoRepo, osRepo);

    await expect(useCase.execute({ id: 'nao-existe' })).rejects.toBeInstanceOf(
      ServicoNaoEncontradoError,
    );
  });

  it('deve falhar quando servico estiver em uso por OS ativa', async () => {
    const servicoRepo = new InMemoryServicoRepository();
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const criar = new CriarServicoUseCase(servicoRepo);
    const remover = new RemoverServicoUseCase(servicoRepo, osRepo);
    const { id } = await criar.execute({
      nome: 'Alinhamento',
      descricao: 'Descricao',
      precoEmCentavos: 10000,
    });
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico(id, new Dinheiro(10000));
    await osRepo.save(os);

    await expect(remover.execute({ id })).rejects.toBeInstanceOf(
      EntidadeEmUsoNaoPodeSerRemovidaError,
    );
  });

  it('deve desativar servico quando nao estiver em uso', async () => {
    const servicoRepo = new InMemoryServicoRepository();
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const criar = new CriarServicoUseCase(servicoRepo);
    const remover = new RemoverServicoUseCase(servicoRepo, osRepo);
    const { id } = await criar.execute({
      nome: 'Alinhamento',
      descricao: 'Descricao',
      precoEmCentavos: 10000,
    });

    await remover.execute({ id });

    const servico = await servicoRepo.findById(id);
    expect(servico?.ativo).toBe(false);
  });
});
