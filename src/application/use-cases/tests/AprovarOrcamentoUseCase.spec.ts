import { AprovarOrcamentoUseCase } from '../AprovarOrcamentoUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { TransicaoStatusInvalidaError } from '../../../domain/errors/TransicaoStatusInvalidaError';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';

describe('AprovarOrcamentoUseCase', () => {
  it('deve falhar se OS nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new AprovarOrcamentoUseCase(osRepo);

    await expect(
      useCase.execute({ osId: 'os-inexistente' }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve falhar se OS estiver fora de AGUARDANDO_APROVACAO', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new AprovarOrcamentoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.gerarOrcamento();
    await osRepo.save(os);

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      TransicaoStatusInvalidaError,
    );
  });

  it('deve aprovar orcamento com sucesso', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new AprovarOrcamentoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();
    await osRepo.save(os);

    await useCase.execute({ osId: os.getId() });

    const saved = await osRepo.findById(os.getId());
    expect(saved?.status).toBe('AGUARDANDO_APROVACAO');
    expect(saved?.orcamentoAprovado).toBe(true);
  });
});
