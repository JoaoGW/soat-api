import { StatusOS } from '../../../../domain/enums/StatusOS';
import { OrdemDeServico } from '../../../../domain/entities/OrdemDeServico';
import { InMemoryOrdemDeServicoRepository } from '../../fakes/InMemoryOrdemDeServicoRepository';
import { ListarOrdensDeServicoUseCase } from '../../ordem-servico/ListarOrdensDeServicoUseCase';
import { CriarOrdemDeServicoUseCase } from '../../CriarOrdemDeServicoUseCase';
import { InMemoryClienteRepository } from '../../fakes/InMemoryClienteRepository';
import { InMemoryPecaRepository } from '../../fakes/InMemoryPecaRepository';
import { InMemoryServicoRepository } from '../../fakes/InMemoryServicoRepository';
import { InMemoryVeiculoRepository } from '../../fakes/InMemoryVeiculoRepository';
import { makeCliente, makeVeiculo } from '../_helpers';
import { Dinheiro } from '../../../../domain/value-objects/Dinheiro';

function prepararAteAguardandoAprovacao(os: OrdemDeServico): void {
  os.iniciarDiagnostico();
  os.adicionarServico('servico-1', new Dinheiro(10000));
  os.gerarOrcamento();
  os.enviarOrcamentoParaAprovacao();
}

function definirDataCriacao(os: OrdemDeServico, dataCriacao: Date): void {
  (os as unknown as { props: { dataCriacao: Date } }).props.dataCriacao =
    dataCriacao;
}

describe('ListarOrdensDeServicoUseCase', () => {
  it('deve retornar lista vazia quando nao houver OS', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ListarOrdensDeServicoUseCase(repo);

    const result = await useCase.execute();
    expect(result).toHaveLength(0);
  });

  it('deve listar OS com dados', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const veiculoRepo = new InMemoryVeiculoRepository();
    const servicoRepo = new InMemoryServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const criarOs = new CriarOrdemDeServicoUseCase(
      osRepo,
      clienteRepo,
      veiculoRepo,
      servicoRepo,
      pecaRepo,
    );
    const useCase = new ListarOrdensDeServicoUseCase(osRepo);
    const cliente = makeCliente();
    await clienteRepo.save(cliente);
    const veiculo = makeVeiculo(cliente.getId());
    await veiculoRepo.save(veiculo);

    await criarOs.execute({
      clienteId: cliente.getId(),
      veiculoId: veiculo.getId(),
    });

    const result = await useCase.execute();
    expect(result).toHaveLength(1);
  });

  it('deve filtrar por status', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ListarOrdensDeServicoUseCase(osRepo);
    const os1 = OrdemDeServico.criar('c1', 'v1');
    const os2 = OrdemDeServico.criar('c2', 'v2');
    os2.iniciarDiagnostico();
    await osRepo.save(os1);
    await osRepo.save(os2);

    const filtradas = await useCase.execute({
      status: StatusOS.EM_DIAGNOSTICO,
    });
    expect(filtradas).toHaveLength(1);
    expect(filtradas[0].status).toBe(StatusOS.EM_DIAGNOSTICO);
  });

  it('deve ordenar por prioridade de status', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ListarOrdensDeServicoUseCase(osRepo);
    const recebida = OrdemDeServico.criar('c1', 'v1');
    const diagnostico = OrdemDeServico.criar('c2', 'v2');
    diagnostico.iniciarDiagnostico();
    const aguardando = OrdemDeServico.criar('c3', 'v3');
    prepararAteAguardandoAprovacao(aguardando);
    const execucao = OrdemDeServico.criar('c4', 'v4');
    prepararAteAguardandoAprovacao(execucao);
    execucao.aprovarOrcamento();
    execucao.iniciarExecucao();
    await osRepo.save(recebida);
    await osRepo.save(diagnostico);
    await osRepo.save(aguardando);
    await osRepo.save(execucao);

    const resultado = await useCase.execute();

    expect(resultado.map((os) => os.status)).toEqual([
      StatusOS.EM_EXECUCAO,
      StatusOS.AGUARDANDO_APROVACAO,
      StatusOS.EM_DIAGNOSTICO,
      StatusOS.RECEBIDA,
    ]);
  });

  it('deve ordenar mais antigas primeiro dentro do mesmo status', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ListarOrdensDeServicoUseCase(osRepo);
    const maisNova = OrdemDeServico.criar('c1', 'v1');
    const maisAntiga = OrdemDeServico.criar('c2', 'v2');
    definirDataCriacao(maisNova, new Date('2026-01-02T00:00:00.000Z'));
    definirDataCriacao(maisAntiga, new Date('2026-01-01T00:00:00.000Z'));
    await osRepo.save(maisNova);
    await osRepo.save(maisAntiga);

    const resultado = await useCase.execute();

    expect(resultado[0].getId()).toBe(maisAntiga.getId());
    expect(resultado[1].getId()).toBe(maisNova.getId());
  });

  it('deve ordenar antes de paginar', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ListarOrdensDeServicoUseCase(osRepo);
    const recebida = OrdemDeServico.criar('c1', 'v1');
    const execucao = OrdemDeServico.criar('c2', 'v2');
    prepararAteAguardandoAprovacao(execucao);
    execucao.aprovarOrcamento();
    execucao.iniciarExecucao();
    await osRepo.save(recebida);
    await osRepo.save(execucao);

    const resultado = await useCase.execute({ page: 1, limit: 1 });

    expect(resultado).toHaveLength(1);
    expect(resultado[0].status).toBe(StatusOS.EM_EXECUCAO);
  });

  it('deve excluir FINALIZADA, ENTREGUE e CANCELADA da listagem', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ListarOrdensDeServicoUseCase(osRepo);
    const ativa = OrdemDeServico.criar('c1', 'v1');
    const finalizada = OrdemDeServico.criar('c2', 'v2');
    prepararAteAguardandoAprovacao(finalizada);
    finalizada.aprovarOrcamento();
    finalizada.iniciarExecucao();
    finalizada.finalizarServico();
    const entregue = OrdemDeServico.criar('c3', 'v3');
    prepararAteAguardandoAprovacao(entregue);
    entregue.aprovarOrcamento();
    entregue.iniciarExecucao();
    entregue.finalizarServico();
    entregue.entregarVeiculo();
    const cancelada = OrdemDeServico.criar('c4', 'v4');
    prepararAteAguardandoAprovacao(cancelada);
    cancelada.recusarOrcamento();
    await osRepo.save(ativa);
    await osRepo.save(finalizada);
    await osRepo.save(entregue);
    await osRepo.save(cancelada);

    const resultado = await useCase.execute();

    expect(resultado).toHaveLength(1);
    expect(resultado[0].status).toBe(StatusOS.RECEBIDA);
    expect(resultado.every((os) => os.status !== StatusOS.FINALIZADA)).toBe(
      true,
    );
    expect(resultado.every((os) => os.status !== StatusOS.ENTREGUE)).toBe(true);
    expect(resultado.every((os) => os.status !== StatusOS.CANCELADA)).toBe(
      true,
    );
  });

  it('deve retornar lista vazia quando so houver OS finalizadas, entregues ou canceladas', async () => {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ListarOrdensDeServicoUseCase(osRepo);
    const finalizada = OrdemDeServico.criar('c1', 'v1');
    prepararAteAguardandoAprovacao(finalizada);
    finalizada.aprovarOrcamento();
    finalizada.iniciarExecucao();
    finalizada.finalizarServico();
    const entregue = OrdemDeServico.criar('c2', 'v2');
    prepararAteAguardandoAprovacao(entregue);
    entregue.aprovarOrcamento();
    entregue.iniciarExecucao();
    entregue.finalizarServico();
    entregue.entregarVeiculo();
    const cancelada = OrdemDeServico.criar('c3', 'v3');
    prepararAteAguardandoAprovacao(cancelada);
    cancelada.recusarOrcamento();
    await osRepo.save(finalizada);
    await osRepo.save(entregue);
    await osRepo.save(cancelada);

    const resultado = await useCase.execute();

    expect(resultado).toHaveLength(0);
  });
});
