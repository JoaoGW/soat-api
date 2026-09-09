import { IniciarDiagnosticoUseCase } from '../IniciarDiagnosticoUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { TransicaoStatusInvalidaError } from '../../../domain/errors/TransicaoStatusInvalidaError';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';

describe('IniciarDiagnosticoUseCase', () => {
  it('deve falhar se OS nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new IniciarDiagnosticoUseCase(osRepo);

    await expect(
      useCase.execute({ osId: 'os-inexistente' }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve transicionar RECEBIDA para EM_DIAGNOSTICO', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new IniciarDiagnosticoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await osRepo.save(os);

    await useCase.execute({ osId: os.getId() });

    const saved = await osRepo.findById(os.getId());
    expect(saved?.status).toBe('EM_DIAGNOSTICO');
  });

  it('deve falhar em transicao invalida', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new IniciarDiagnosticoUseCase(osRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    await osRepo.save(os);

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      TransicaoStatusInvalidaError,
    );
  });
});
