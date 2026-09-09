import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdicionarPecaOSUseCase } from '../../src/application/use-cases/AdicionarPecaOSUseCase';
import { AdicionarServicoOSUseCase } from '../../src/application/use-cases/AdicionarServicoOSUseCase';
import { AprovarOrcamentoUseCase } from '../../src/application/use-cases/AprovarOrcamentoUseCase';
import { CriarOrdemDeServicoUseCase } from '../../src/application/use-cases/CriarOrdemDeServicoUseCase';
import { EntregarVeiculoUseCase } from '../../src/application/use-cases/EntregarVeiculoUseCase';
import { EnviarOrcamentoParaAprovacaoUseCase } from '../../src/application/use-cases/EnviarOrcamentoParaAprovacaoUseCase';
import { FinalizarServicoUseCase } from '../../src/application/use-cases/FinalizarServicoUseCase';
import { GerarOrcamentoUseCase } from '../../src/application/use-cases/GerarOrcamentoUseCase';
import { IniciarDiagnosticoUseCase } from '../../src/application/use-cases/IniciarDiagnosticoUseCase';
import { IniciarExecucaoUseCase } from '../../src/application/use-cases/IniciarExecucaoUseCase';
import { OrdemDeServico } from '../../src/domain/entities/OrdemDeServico';
import { StatusOS } from '../../src/domain/enums/StatusOS';
import { Dinheiro } from '../../src/domain/value-objects/Dinheiro';
import { Quantidade } from '../../src/domain/value-objects/Quantidade';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';
import { PrismaClienteRepository } from '../../src/infrastructure/repositories/PrismaClienteRepository';
import { PrismaOrdemDeServicoRepository } from '../../src/infrastructure/repositories/PrismaOrdemDeServicoRepository';
import { PrismaPecaRepository } from '../../src/infrastructure/repositories/PrismaPecaRepository';
import { PrismaServicoRepository } from '../../src/infrastructure/repositories/PrismaServicoRepository';
import { PrismaVeiculoRepository } from '../../src/infrastructure/repositories/PrismaVeiculoRepository';
import { autenticarAdmin } from '../helpers/autenticarAdmin';
import { criarAppDeTeste } from '../helpers/criarAppDeTeste';
import {
  criarDependenciasParaOS,
  limparBancoDeTeste,
} from '../helpers/limparBancoDeTeste';

describe('Ordens de Servico (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let osRepo: PrismaOrdemDeServicoRepository;
  let clienteRepo: PrismaClienteRepository;
  let veiculoRepo: PrismaVeiculoRepository;
  let servicoRepo: PrismaServicoRepository;
  let pecaRepo: PrismaPecaRepository;

  beforeAll(async () => {
    app = await criarAppDeTeste();
    prisma = app.get(PrismaService);
    osRepo = app.get(PrismaOrdemDeServicoRepository);
    clienteRepo = app.get(PrismaClienteRepository);
    veiculoRepo = app.get(PrismaVeiculoRepository);
    servicoRepo = app.get(PrismaServicoRepository);
    pecaRepo = app.get(PrismaPecaRepository);
  });

  beforeEach(async () => {
    await limparBancoDeTeste(prisma);
    token = await autenticarAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function criarClienteVeiculoServicoEPeca() {
    const clienteResponse = await request(app.getHttpServer())
      .post('/clientes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Cliente Fase 27',
        documento: '52998224725',
        contato: 'fase27@email.com',
      })
      .expect(201);
    const clienteId = clienteResponse.body.id as string;

    const veiculoResponse = await request(app.getHttpServer())
      .post('/veiculos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clienteId,
        placa: 'FSE2G27',
        marca: 'Fiat',
        modelo: 'Pulse',
        ano: 2024,
      })
      .expect(201);
    const veiculoId = veiculoResponse.body.id as string;

    const servicoResponse = await request(app.getHttpServer())
      .post('/servicos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Diagnostico completo',
        descricao: 'Diagnostico eletronico',
        precoEmCentavos: 18000,
      })
      .expect(201);
    const servicoId = servicoResponse.body.id as string;

    const pecaResponse = await request(app.getHttpServer())
      .post('/pecas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Sensor de teste',
        precoEmCentavos: 7500,
        quantidadeEstoque: 5,
      })
      .expect(201);
    const pecaId = pecaResponse.body.id as string;

    return { clienteId, veiculoId, servicoId, pecaId };
  }

  function prepararAteAguardandoAprovacao(os: OrdemDeServico): void {
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();
  }

  it('GET /ordens-servico sem token deve retornar 401', async () => {
    await request(app.getHttpServer()).get('/ordens-servico').expect(401);
  });

  it('POST /ordens-servico deve retornar id, codigoAcompanhamento, status e dataCriacao', async () => {
    const { clienteId, veiculoId } = await criarClienteVeiculoServicoEPeca();

    const response = await request(app.getHttpServer())
      .post('/ordens-servico')
      .set('Authorization', `Bearer ${token}`)
      .send({ clienteId, veiculoId })
      .expect(201);

    expect(response.body.id).toBeTruthy();
    expect(response.body.codigoAcompanhamento).toMatch(/^OS-\d{4}-/);
    expect(response.body.status).toBe(StatusOS.RECEBIDA);
    expect(response.body.dataCriacao).toBeTruthy();
  });

  it('POST /ordens-servico deve aceitar servicos e pecas opcionais no payload', async () => {
    const { clienteId, veiculoId, servicoId, pecaId } =
      await criarClienteVeiculoServicoEPeca();

    const response = await request(app.getHttpServer())
      .post('/ordens-servico')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clienteId,
        veiculoId,
        servicos: [{ servicoId }],
        pecas: [{ pecaId, quantidade: 2 }],
      })
      .expect(201);

    const osCriada = await osRepo.findById(response.body.id);
    expect(osCriada?.servicos).toHaveLength(1);
    expect(osCriada?.itens).toHaveLength(1);
  });

  it('POST /ordens-servico/:id/recusar-orcamento deve cancelar OS em aguardando aprovacao', async () => {
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    prepararAteAguardandoAprovacao(os);
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    await request(app.getHttpServer())
      .post(`/ordens-servico/${os.getId()}/recusar-orcamento`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const osAtualizada = await osRepo.findById(os.getId());
    expect(osAtualizada?.status).toBe(StatusOS.CANCELADA);
  });

  it('POST /ordens-servico/:id/recusar-orcamento deve retornar 401 sem token', async () => {
    await request(app.getHttpServer())
      .post('/ordens-servico/os-1/recusar-orcamento')
      .expect(401);
  });

  it('POST /ordens-servico/:id/recusar-orcamento deve retornar erro para OS inexistente', async () => {
    await request(app.getHttpServer())
      .post('/ordens-servico/os-inexistente/recusar-orcamento')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('deve rejeitar OS com cliente ou veiculo inexistente no banco', async () => {
    await expect(
      prisma.ordemDeServico.create({
        data: {
          id: 'os-sem-relacionamentos',
          codigoAcompanhamento: 'OS-2026-SEMFK1',
          clienteId: 'cliente-inexistente',
          veiculoId: 'veiculo-inexistente',
          status: StatusOS.RECEBIDA,
        },
      }),
    ).rejects.toThrow();
  });

  it('deve impedir alteracao ou exclusao de eventos do historico', async () => {
    const os = OrdemDeServico.criar(
      'cliente-append-only',
      'veiculo-append-only',
    );
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    const evento = await prisma.historicoStatusOS.findFirstOrThrow({
      where: { osId: os.getId() },
    });

    await expect(
      prisma.historicoStatusOS.update({
        where: { id: evento.id },
        data: { status: StatusOS.EM_DIAGNOSTICO },
      }),
    ).rejects.toThrow('HistoricoStatusOS is append-only');
    await expect(
      prisma.historicoStatusOS.delete({ where: { id: evento.id } }),
    ).rejects.toThrow('HistoricoStatusOS is append-only');
  });

  it('deve fazer rollback da OS, itens e historico se a persistencia falhar', async () => {
    const os = OrdemDeServico.criar('cliente-rollback', 'veiculo-rollback');
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    os.iniciarDiagnostico();
    os.adicionarPeca(
      'peca-inexistente',
      new Quantidade(1),
      new Dinheiro(1_000),
    );

    await expect(osRepo.save(os)).rejects.toThrow();

    const osPersistida = await osRepo.findById(os.getId());
    const historico = await prisma.historicoStatusOS.findMany({
      where: { osId: os.getId() },
      orderBy: { ocorridoEm: 'asc' },
    });
    expect(osPersistida?.status).toBe(StatusOS.RECEBIDA);
    expect(osPersistida?.itens).toHaveLength(0);
    expect(historico.map((evento) => evento.status)).toEqual([
      StatusOS.RECEBIDA,
    ]);
  });

  it('GET /ordens-servico deve ordenar por prioridade e excluir encerradas', async () => {
    const recebida = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    const aguardando = OrdemDeServico.criar('cliente-2', 'veiculo-2');
    prepararAteAguardandoAprovacao(aguardando);
    const execucao = OrdemDeServico.criar('cliente-3', 'veiculo-3');
    prepararAteAguardandoAprovacao(execucao);
    execucao.aprovarOrcamento();
    execucao.iniciarExecucao();
    const finalizada = OrdemDeServico.criar('cliente-4', 'veiculo-4');
    prepararAteAguardandoAprovacao(finalizada);
    finalizada.aprovarOrcamento();
    finalizada.iniciarExecucao();
    finalizada.finalizarServico();
    const cancelada = OrdemDeServico.criar('cliente-5', 'veiculo-5');
    prepararAteAguardandoAprovacao(cancelada);
    cancelada.recusarOrcamento();
    await criarDependenciasParaOS(prisma, [
      recebida,
      aguardando,
      execucao,
      finalizada,
      cancelada,
    ]);
    await osRepo.save(recebida);
    await osRepo.save(aguardando);
    await osRepo.save(execucao);
    await osRepo.save(finalizada);
    await osRepo.save(cancelada);

    const response = await request(app.getHttpServer())
      .get('/ordens-servico')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const statuses = response.body.map((os: any) => os.props.status);
    expect(statuses).toEqual([
      StatusOS.EM_EXECUCAO,
      StatusOS.AGUARDANDO_APROVACAO,
      StatusOS.RECEBIDA,
    ]);
    expect(statuses).not.toContain(StatusOS.FINALIZADA);
    expect(statuses).not.toContain(StatusOS.CANCELADA);
  });

  it('GET /ordens-servico deve ordenar antes de paginar no banco', async () => {
    const recebida = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    const execucao = OrdemDeServico.criar('cliente-2', 'veiculo-2');
    prepararAteAguardandoAprovacao(execucao);
    execucao.aprovarOrcamento();
    execucao.iniciarExecucao();
    await criarDependenciasParaOS(prisma, [recebida, execucao]);
    await osRepo.save(recebida);
    await osRepo.save(execucao);

    const response = await request(app.getHttpServer())
      .get('/ordens-servico?page=1&limit=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].props.status).toBe(StatusOS.EM_EXECUCAO);
  });

  it('deve executar fluxo completo da OS e validar status final ENTREGUE', async () => {
    const clienteResponse = await request(app.getHttpServer())
      .post('/clientes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Cliente Fluxo',
        documento: '52998224725',
        contato: 'fluxo@email.com',
      })
      .expect(201);
    const clienteId = clienteResponse.body.id as string;

    const veiculoResponse = await request(app.getHttpServer())
      .post('/veiculos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clienteId,
        placa: 'QWE1R23',
        marca: 'Honda',
        modelo: 'Civic',
        ano: 2022,
      })
      .expect(201);
    const veiculoId = veiculoResponse.body.id as string;

    const servicoResponse = await request(app.getHttpServer())
      .post('/servicos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Troca de oleo',
        descricao: 'Troca e filtro',
        precoEmCentavos: 20000,
      })
      .expect(201);
    const servicoId = servicoResponse.body.id as string;

    const pecaResponse = await request(app.getHttpServer())
      .post('/pecas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Filtro de oleo',
        precoEmCentavos: 5000,
        quantidadeEstoque: 3,
      })
      .expect(201);
    const pecaId = pecaResponse.body.id as string;

    const criarOS = new CriarOrdemDeServicoUseCase(
      osRepo,
      clienteRepo,
      veiculoRepo,
      servicoRepo,
      pecaRepo,
    );
    const iniciarDiagnostico = new IniciarDiagnosticoUseCase(osRepo);
    const adicionarServico = new AdicionarServicoOSUseCase(osRepo, servicoRepo);
    const adicionarPeca = new AdicionarPecaOSUseCase(osRepo, pecaRepo);
    const gerarOrcamento = new GerarOrcamentoUseCase(osRepo);
    const notificacaoFake = {
      enviarNotificacaoOrcamento: jest.fn().mockResolvedValue(undefined),
    };
    const webhookTokensFake = {
      gerarToken: jest
        .fn()
        .mockImplementation(({ acao }) => Promise.resolve(`token-${acao}`)),
      validarToken: jest.fn(),
    };
    const enviarOrcamento = new EnviarOrcamentoParaAprovacaoUseCase(
      osRepo,
      clienteRepo,
      notificacaoFake,
      webhookTokensFake,
    );
    const aprovarOrcamento = new AprovarOrcamentoUseCase(osRepo);
    const iniciarExecucao = new IniciarExecucaoUseCase(osRepo, pecaRepo);
    const finalizar = new FinalizarServicoUseCase(osRepo);
    const entregar = new EntregarVeiculoUseCase(osRepo);

    const osCriada = await criarOS.execute({ clienteId, veiculoId });
    await iniciarDiagnostico.execute({ osId: osCriada.id });
    await adicionarServico.execute({ osId: osCriada.id, servicoId });
    await adicionarPeca.execute({
      osId: osCriada.id,
      pecaId,
      quantidade: 2,
    });
    await gerarOrcamento.execute({ osId: osCriada.id });
    await enviarOrcamento.execute({ osId: osCriada.id });
    await aprovarOrcamento.execute({ osId: osCriada.id });
    await iniciarExecucao.execute({ osId: osCriada.id });
    await finalizar.execute({ osId: osCriada.id });
    await entregar.execute({ osId: osCriada.id });

    const pecaAposExecucao = await request(app.getHttpServer())
      .get(`/pecas/${pecaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(pecaAposExecucao.body.props.quantidadeEstoque.props.valor).toBe(1);

    const listaOs = await request(app.getHttpServer())
      .get('/ordens-servico')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listaOs.body).toHaveLength(0);

    const detalheOs = await request(app.getHttpServer())
      .get(`/ordens-servico/${osCriada.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detalheOs.body.props.status).toBe('ENTREGUE');

    const consultaPublica = await request(app.getHttpServer())
      .get(`/consulta/os/${osCriada.codigoAcompanhamento}/status`)
      .expect(200);
    expect(consultaPublica.body.status).toBe('ENTREGUE');

    const historico = await prisma.historicoStatusOS.findMany({
      where: { osId: osCriada.id },
      orderBy: { ocorridoEm: 'asc' },
    });
    expect(historico.map((evento) => evento.status)).toEqual([
      StatusOS.RECEBIDA,
      StatusOS.EM_DIAGNOSTICO,
      StatusOS.AGUARDANDO_APROVACAO,
      StatusOS.EM_EXECUCAO,
      StatusOS.FINALIZADA,
      StatusOS.ENTREGUE,
    ]);
  });
});
