import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { StatusOS } from '../../../domain/enums/StatusOS';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { TransicaoStatusInvalidaError } from '../../../domain/errors/TransicaoStatusInvalidaError';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { RecusarOrcamentoUseCase } from '../RecusarOrcamentoUseCase';

describe('RecusarOrcamentoUseCase', () => {
  function makeSut() {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new RecusarOrcamentoUseCase(osRepo);

    return { osRepo, useCase };
  }

  function criarOSEmAguardandoAprovacao(): OrdemDeServico {
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(12000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();

    return os;
  }

  it('deve recusar orcamento com sucesso', async () => {
    const { osRepo, useCase } = makeSut();
    const os = criarOSEmAguardandoAprovacao();
    await osRepo.save(os);

    await useCase.execute({ osId: os.getId() });

    const osAtualizada = await osRepo.findById(os.getId());
    expect(osAtualizada?.status).toBe(StatusOS.CANCELADA);
  });

  it('deve persistir a OS alterada no repositorio', async () => {
    const { osRepo, useCase } = makeSut();
    const os = criarOSEmAguardandoAprovacao();
    await osRepo.save(os);

    await useCase.execute({ osId: os.getId() });

    const osNoRepo = osRepo.items.find((item) => item.getId() === os.getId());
    expect(osNoRepo?.status).toBe(StatusOS.CANCELADA);
  });

  it('deve lancar OrdemDeServicoNaoEncontradaError para OS inexistente', async () => {
    const { useCase } = makeSut();

    await expect(
      useCase.execute({ osId: 'os-inexistente' }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve lancar TransicaoStatusInvalidaError ao recusar OS fora de AGUARDANDO_APROVACAO', async () => {
    const { osRepo, useCase } = makeSut();
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      TransicaoStatusInvalidaError,
    );
  });
});
