import { IniciarExecucaoUseCase } from '../IniciarExecucaoUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { InMemoryPecaRepository } from '../fakes/InMemoryPecaRepository';
import { OrdemDeServicoNaoEncontradaError } from '../../../domain/errors/OrdemDeServicoNaoEncontradaError';
import { OrcamentoNaoAprovadoError } from '../../../domain/errors/OrcamentoNaoAprovadoError';
import { EstoqueInsuficienteError } from '../../../domain/errors/EstoqueInsuficienteError';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';
import { Quantidade } from '../../../domain/value-objects/Quantidade';
import { makePeca } from './_helpers';

describe('IniciarExecucaoUseCase', () => {
  it('deve falhar se OS nao existir', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new IniciarExecucaoUseCase(osRepo, pecaRepo);

    await expect(
      useCase.execute({ osId: 'os-inexistente' }),
    ).rejects.toBeInstanceOf(OrdemDeServicoNaoEncontradaError);
  });

  it('deve falhar se orcamento nao tiver sido aprovado', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new IniciarExecucaoUseCase(osRepo, pecaRepo);
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();
    await osRepo.save(os);

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      OrcamentoNaoAprovadoError,
    );
  });

  it('deve falhar se houver estoque insuficiente no inicio da execucao', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new IniciarExecucaoUseCase(osRepo, pecaRepo);

    const peca = makePeca('Filtro', 5000, 1);
    await pecaRepo.save(peca);

    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.adicionarPeca(peca.getId(), new Quantidade(2), new Dinheiro(5000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();
    os.aprovarOrcamento();
    await osRepo.save(os);

    await expect(useCase.execute({ osId: os.getId() })).rejects.toBeInstanceOf(
      EstoqueInsuficienteError,
    );
  });

  it('deve baixar estoque e iniciar execucao com sucesso', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new IniciarExecucaoUseCase(osRepo, pecaRepo);

    const peca = makePeca('Filtro', 5000, 5);
    await pecaRepo.save(peca);

    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.adicionarPeca(peca.getId(), new Quantidade(2), new Dinheiro(5000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();
    os.aprovarOrcamento();
    await osRepo.save(os);

    await useCase.execute({ osId: os.getId() });

    const osSalva = await osRepo.findById(os.getId());
    const pecaAtualizada = await pecaRepo.findById(peca.getId());
    expect(osSalva?.status).toBe('EM_EXECUCAO');
    expect(osSalva?.dataInicioExecucao).toBeInstanceOf(Date);
    expect(pecaAtualizada?.quantidadeEstoque).toBe(3);
  });
});
