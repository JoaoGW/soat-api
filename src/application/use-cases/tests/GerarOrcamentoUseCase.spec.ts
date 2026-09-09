import { GerarOrcamentoUseCase } from '../GerarOrcamentoUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { OrdemDeServicoSemServicoError } from '../../../domain/errors/OrdemDeServicoSemServicoError';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';
import { Quantidade } from '../../../domain/value-objects/Quantidade';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';

describe('GerarOrcamentoUseCase', () => {
  it('deve falhar se OS nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new GerarOrcamentoUseCase(osRepo);

    await expect(
      useCase.execute({ osId: 'os-inexistente' }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve falhar se OS nao tiver servicos', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new GerarOrcamentoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    await osRepo.save(os);

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      OrdemDeServicoSemServicoError,
    );
  });

  it('deve calcular valor total com servicos e pecas', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new GerarOrcamentoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(15000));
    os.adicionarPeca('peca-1', new Quantidade(2), new Dinheiro(5000));
    await osRepo.save(os);

    const output = await useCase.execute({ osId: os.getId() });

    expect(output.valorTotal).toBe(25000);
    const saved = await osRepo.findById(os.getId());
    expect(saved?.valorTotal.centavos).toBe(25000);
    expect(saved?.orcamentoGerado).toBe(true);
  });
});
