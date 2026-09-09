import { AdicionarServicoOSUseCase } from '../AdicionarServicoOSUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { InMemoryServicoRepository } from '../fakes/InMemoryServicoRepository';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { ServicoNaoEncontradoError } from '../../../domain/errors/ServicoNaoEncontradoError';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { makeServico } from './_helpers';

describe('AdicionarServicoOSUseCase', () => {
  it('deve falhar se OS nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const servicoRepo = new InMemoryServicoRepository();
    const useCase = new AdicionarServicoOSUseCase(osRepo, servicoRepo);

    const servico = makeServico();
    await servicoRepo.save(servico);

    await expect(
      useCase.execute({ osId: 'os-inexistente', servicoId: servico.getId() }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve falhar se servico nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const servicoRepo = new InMemoryServicoRepository();
    const useCase = new AdicionarServicoOSUseCase(osRepo, servicoRepo);

    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);

    await expect(
      useCase.execute({ osId: os.getId(), servicoId: 'servico-inexistente' }),
    ).rejects.toBeInstanceOf(ServicoNaoEncontradoError);
  });

  it('deve adicionar servico com preco preservado', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const servicoRepo = new InMemoryServicoRepository();
    const useCase = new AdicionarServicoOSUseCase(osRepo, servicoRepo);

    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);

    const servico = makeServico('Balanceamento', 19990);
    await servicoRepo.save(servico);

    await useCase.execute({ osId: os.getId(), servicoId: servico.getId() });

    const saved = await osRepo.findById(os.getId());
    expect(saved?.servicos).toHaveLength(1);
    expect(saved?.servicos[0].servicoId).toBe(servico.getId());
    expect(saved?.servicos[0].preco.centavos).toBe(19990);
  });
});
