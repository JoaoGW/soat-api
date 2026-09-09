import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { CodigoAcompanhamento } from '../../../domain/value-objects/CodigoAcompanhamento';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';
import { StatusOS } from '../../../domain/enums/StatusOS';
import { ObterTempoMedioExecucaoUseCase } from '../ObterTempoMedioExecucaoUseCase';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';

describe('ObterTempoMedioExecucaoUseCase', () => {
  it('deve retornar 0 quando nao houver OS finalizada', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ObterTempoMedioExecucaoUseCase(repo);

    await repo.save(makeOsSemInicio());
    await repo.save(makeOsSemFinalizacao());

    const result = await useCase.execute();
    expect(result).toEqual({
      mediaEmMinutos: 0,
      totalOSConsideradas: 0,
      etapas: etapasZeradas(),
    });
  });

  it('deve calcular media corretamente para uma OS', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ObterTempoMedioExecucaoUseCase(repo);
    await repo.save(makeOsComPeriodo(120));

    const result = await useCase.execute();
    expect(result).toEqual({
      mediaEmMinutos: 120,
      totalOSConsideradas: 1,
      etapas: etapasZeradas(),
    });
  });

  it('deve calcular media corretamente para multiplas OS', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ObterTempoMedioExecucaoUseCase(repo);
    await repo.save(makeOsComPeriodo(60));
    await repo.save(makeOsComPeriodo(120));
    await repo.save(makeOsSemFinalizacao());

    const result = await useCase.execute();
    expect(result).toEqual({
      mediaEmMinutos: 90,
      totalOSConsideradas: 2,
      etapas: etapasZeradas(),
    });
  });

  it('deve calcular medias por etapa apenas quando o periodo foi concluido', async () => {
    const repo = new InMemoryOrdemDeServicoRepository();
    const useCase = new ObterTempoMedioExecucaoUseCase(repo);
    const inicio = new Date('2026-01-01T08:00:00.000Z');
    repo.historicoStatus = [
      {
        osId: 'os-completa',
        status: StatusOS.EM_DIAGNOSTICO,
        ocorridoEm: inicio,
      },
      {
        osId: 'os-completa',
        status: StatusOS.AGUARDANDO_APROVACAO,
        ocorridoEm: new Date(inicio.getTime() + 30 * 60_000),
      },
      {
        osId: 'os-completa',
        status: StatusOS.EM_EXECUCAO,
        ocorridoEm: new Date(inicio.getTime() + 60 * 60_000),
      },
      {
        osId: 'os-completa',
        status: StatusOS.FINALIZADA,
        ocorridoEm: new Date(inicio.getTime() + 180 * 60_000),
      },
      {
        osId: 'os-completa',
        status: StatusOS.ENTREGUE,
        ocorridoEm: new Date(inicio.getTime() + 195 * 60_000),
      },
      {
        osId: 'os-incompleta',
        status: StatusOS.EM_DIAGNOSTICO,
        ocorridoEm: inicio,
      },
    ];

    await expect(useCase.execute()).resolves.toEqual({
      mediaEmMinutos: 0,
      totalOSConsideradas: 0,
      etapas: {
        diagnostico: { mediaEmMinutos: 30, totalOSConsideradas: 1 },
        execucao: { mediaEmMinutos: 120, totalOSConsideradas: 1 },
        finalizacao: { mediaEmMinutos: 15, totalOSConsideradas: 1 },
      },
    });
  });
});

function etapasZeradas() {
  return {
    diagnostico: { mediaEmMinutos: 0, totalOSConsideradas: 0 },
    execucao: { mediaEmMinutos: 0, totalOSConsideradas: 0 },
    finalizacao: { mediaEmMinutos: 0, totalOSConsideradas: 0 },
  };
}

function makeOsComPeriodo(minutos: number): OrdemDeServico {
  const inicio = new Date('2026-01-01T10:00:00.000Z');
  const fim = new Date(inicio.getTime() + minutos * 60 * 1000);

  return new OrdemDeServico({
    clienteId: 'cliente-1',
    veiculoId: 'veiculo-1',
    codigoAcompanhamento: CodigoAcompanhamento.gerar(),
    status: StatusOS.FINALIZADA,
    servicos: [],
    itens: [],
    valorTotal: Dinheiro.zero(),
    orcamentoGerado: true,
    orcamentoAprovado: true,
    dataInicioExecucao: inicio,
    dataFinalizacao: fim,
    dataCriacao: inicio,
    dataAtualizacao: fim,
  });
}

function makeOsSemInicio(): OrdemDeServico {
  const now = new Date('2026-01-01T10:00:00.000Z');
  return new OrdemDeServico({
    clienteId: 'cliente-2',
    veiculoId: 'veiculo-2',
    codigoAcompanhamento: CodigoAcompanhamento.gerar(),
    status: StatusOS.FINALIZADA,
    servicos: [],
    itens: [],
    valorTotal: Dinheiro.zero(),
    orcamentoGerado: true,
    orcamentoAprovado: true,
    dataFinalizacao: new Date(now.getTime() + 60 * 60000),
    dataCriacao: now,
    dataAtualizacao: now,
  });
}

function makeOsSemFinalizacao(): OrdemDeServico {
  const now = new Date('2026-01-01T10:00:00.000Z');
  return new OrdemDeServico({
    clienteId: 'cliente-3',
    veiculoId: 'veiculo-3',
    codigoAcompanhamento: CodigoAcompanhamento.gerar(),
    status: StatusOS.EM_EXECUCAO,
    servicos: [],
    itens: [],
    valorTotal: Dinheiro.zero(),
    orcamentoGerado: true,
    orcamentoAprovado: true,
    dataInicioExecucao: now,
    dataCriacao: now,
    dataAtualizacao: now,
  });
}
