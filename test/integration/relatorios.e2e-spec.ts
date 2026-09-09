import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OrdemDeServico } from '../../src/domain/entities/OrdemDeServico';
import { StatusOS } from '../../src/domain/enums/StatusOS';
import { CodigoAcompanhamento } from '../../src/domain/value-objects/CodigoAcompanhamento';
import { Dinheiro } from '../../src/domain/value-objects/Dinheiro';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';
import { PrismaOrdemDeServicoRepository } from '../../src/infrastructure/repositories/PrismaOrdemDeServicoRepository';
import { autenticarAdmin } from '../helpers/autenticarAdmin';
import { criarAppDeTeste } from '../helpers/criarAppDeTeste';
import {
  criarDependenciasParaOS,
  limparBancoDeTeste,
} from '../helpers/limparBancoDeTeste';

describe('Relatorios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let osRepo: PrismaOrdemDeServicoRepository;
  let token: string;

  beforeAll(async () => {
    app = await criarAppDeTeste();
    prisma = app.get(PrismaService);
    osRepo = app.get(PrismaOrdemDeServicoRepository);
  });

  beforeEach(async () => {
    await limparBancoDeTeste(prisma);
    token = await autenticarAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  function criarOSFinalizadaComDuracao(
    minutos: number,
    status: StatusOS = StatusOS.FINALIZADA,
  ): OrdemDeServico {
    const inicio = new Date('2026-01-01T10:00:00.000Z');
    const fim = new Date(inicio.getTime() + minutos * 60_000);

    return new OrdemDeServico({
      clienteId: 'cliente-relatorio',
      veiculoId: 'veiculo-relatorio',
      codigoAcompanhamento: CodigoAcompanhamento.gerar(),
      status,
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

  it('sem token deve retornar 401', async () => {
    await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .expect(401);
  });

  it('com token e sem OS finalizada deve retornar media zero', async () => {
    const response = await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      mediaEmMinutos: 0,
      totalOSConsideradas: 0,
      etapas: {
        diagnostico: { mediaEmMinutos: 0, totalOSConsideradas: 0 },
        execucao: { mediaEmMinutos: 0, totalOSConsideradas: 0 },
        finalizacao: { mediaEmMinutos: 0, totalOSConsideradas: 0 },
      },
    });
  });

  it('com token e OS finalizadas deve calcular media corretamente', async () => {
    const osDe60Minutos = criarOSFinalizadaComDuracao(60);
    const osDe180Minutos = criarOSFinalizadaComDuracao(180);
    await criarDependenciasParaOS(prisma, [osDe60Minutos, osDe180Minutos]);
    await osRepo.save(osDe60Minutos);
    await osRepo.save(osDe180Minutos);

    const response = await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      mediaEmMinutos: 120,
      totalOSConsideradas: 2,
      etapas: {
        diagnostico: { mediaEmMinutos: 0, totalOSConsideradas: 0 },
        execucao: { mediaEmMinutos: 0, totalOSConsideradas: 0 },
        finalizacao: { mediaEmMinutos: 0, totalOSConsideradas: 0 },
      },
    });
  });

  it('deve calcular medias por etapa a partir do historico persistido', async () => {
    // The initial RECEBIDA entry does not overlap any measured stage. The
    // explicit events below therefore exercise only the persisted audit trail.
    const os = criarOSFinalizadaComDuracao(120, StatusOS.RECEBIDA);
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    const inicio = new Date('2026-01-01T08:00:00.000Z');
    await prisma.historicoStatusOS.createMany({
      data: [
        {
          osId: os.getId(),
          status: StatusOS.EM_DIAGNOSTICO,
          ocorridoEm: inicio,
        },
        {
          osId: os.getId(),
          status: StatusOS.AGUARDANDO_APROVACAO,
          ocorridoEm: new Date(inicio.getTime() + 30 * 60_000),
        },
        {
          osId: os.getId(),
          status: StatusOS.EM_EXECUCAO,
          ocorridoEm: new Date(inicio.getTime() + 60 * 60_000),
        },
        {
          osId: os.getId(),
          status: StatusOS.FINALIZADA,
          ocorridoEm: new Date(inicio.getTime() + 180 * 60_000),
        },
        {
          osId: os.getId(),
          status: StatusOS.ENTREGUE,
          ocorridoEm: new Date(inicio.getTime() + 195 * 60_000),
        },
      ],
    });

    const response = await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.etapas).toEqual({
      diagnostico: { mediaEmMinutos: 30, totalOSConsideradas: 1 },
      execucao: { mediaEmMinutos: 120, totalOSConsideradas: 1 },
      finalizacao: { mediaEmMinutos: 15, totalOSConsideradas: 1 },
    });
  });
});
