import { OrdemDeServico } from '../../domain/entities/OrdemDeServico';
import { StatusOS } from '../../domain/enums/StatusOS';
import {
  HistoricoStatusOS,
  OrdemDeServicoRepository,
} from '../../domain/repositories/OrdemDeServicoRepository';

type OSFinalizada = OrdemDeServico & {
  dataInicioExecucao: Date;
  dataFinalizacao: Date;
};

export interface MetricaTempoMedio {
  mediaEmMinutos: number;
  totalOSConsideradas: number;
}

export interface RelatorioTempoMedioExecucao extends MetricaTempoMedio {
  etapas: {
    diagnostico: MetricaTempoMedio;
    execucao: MetricaTempoMedio;
    finalizacao: MetricaTempoMedio;
  };
}

export class ObterTempoMedioExecucaoUseCase {
  constructor(private readonly repo: OrdemDeServicoRepository) {}

  async execute(): Promise<RelatorioTempoMedioExecucao> {
    const finalizadasRepo = this.repo.findFinalizadasComPeriodoExecucao
      ? await this.repo.findFinalizadasComPeriodoExecucao()
      : await this.repo.findAll();
    const finalizadas = finalizadasRepo.filter(
      (os): os is OSFinalizada =>
        os.dataInicioExecucao !== undefined && os.dataFinalizacao !== undefined,
    );
    const historico = await this.repo.findHistoricoStatus();

    return {
      ...this.calcularPeriodoDeExecucao(finalizadas),
      etapas: {
        diagnostico: this.calcularEtapa(
          historico,
          StatusOS.EM_DIAGNOSTICO,
          StatusOS.AGUARDANDO_APROVACAO,
        ),
        execucao: this.calcularEtapa(
          historico,
          StatusOS.EM_EXECUCAO,
          StatusOS.FINALIZADA,
        ),
        finalizacao: this.calcularEtapa(
          historico,
          StatusOS.FINALIZADA,
          StatusOS.ENTREGUE,
        ),
      },
    };
  }

  private calcularPeriodoDeExecucao(
    finalizadas: OSFinalizada[],
  ): MetricaTempoMedio {
    const duracoes = finalizadas.map(
      (os) => os.dataFinalizacao.getTime() - os.dataInicioExecucao.getTime(),
    );
    return this.calcularMedia(duracoes);
  }

  private calcularEtapa(
    historico: HistoricoStatusOS[],
    inicio: StatusOS,
    fim: StatusOS,
  ): MetricaTempoMedio {
    const porOs = new Map<string, HistoricoStatusOS[]>();
    for (const evento of historico) {
      const eventos = porOs.get(evento.osId) ?? [];
      eventos.push(evento);
      porOs.set(evento.osId, eventos);
    }

    const duracoes = [...porOs.values()].flatMap((eventos) => {
      const inicioEtapa = eventos.find((evento) => evento.status === inicio);
      if (!inicioEtapa) return [];

      const fimEtapa = eventos.find(
        (evento) =>
          evento.ocorridoEm.getTime() >= inicioEtapa.ocorridoEm.getTime() &&
          evento.status === fim,
      );
      return fimEtapa
        ? [fimEtapa.ocorridoEm.getTime() - inicioEtapa.ocorridoEm.getTime()]
        : [];
    });
    return this.calcularMedia(duracoes);
  }

  private calcularMedia(duracoesEmMs: number[]): MetricaTempoMedio {
    if (duracoesEmMs.length === 0) {
      return { mediaEmMinutos: 0, totalOSConsideradas: 0 };
    }
    const totalEmMs = duracoesEmMs.reduce(
      (total, duracao) => total + duracao,
      0,
    );
    return {
      mediaEmMinutos: Math.round(totalEmMs / duracoesEmMs.length / 60_000),
      totalOSConsideradas: duracoesEmMs.length,
    };
  }
}
