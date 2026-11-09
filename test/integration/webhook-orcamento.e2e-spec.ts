import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { OrdemDeServico } from '../../src/domain/entities/OrdemDeServico';
import { StatusOS } from '../../src/domain/enums/StatusOS';
import { Dinheiro } from '../../src/domain/value-objects/Dinheiro';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';
import { PrismaOrdemDeServicoRepository } from '../../src/infrastructure/repositories/PrismaOrdemDeServicoRepository';
import { criarAppDeTeste } from '../helpers/criarAppDeTeste';
import {
  criarDependenciasParaOS,
  limparBancoDeTeste,
} from '../helpers/limparBancoDeTeste';

describe('Webhook de orcamento (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let osRepo: PrismaOrdemDeServicoRepository;
  let jwtService: JwtService;

  beforeAll(async () => {
    app = await criarAppDeTeste();
    prisma = app.get(PrismaService);
    osRepo = app.get(PrismaOrdemDeServicoRepository);
    jwtService = app.get(JwtService);
  });

  beforeEach(async () => {
    await limparBancoDeTeste(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function criarOSEmAguardandoAprovacao(): OrdemDeServico {
    const os = OrdemDeServico.criar('cliente-id', 'veiculo-id');
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();

    return os;
  }

  async function gerarTokenWebhook(
    osId: string,
    acao: 'aprovar' | 'recusar',
    expiresIn = '1h',
  ): Promise<string> {
    return jwtService.signAsync(
      { osId, acao },
      {
        secret: process.env.WEBHOOK_SECRET,
        expiresIn: expiresIn as any,
      },
    );
  }

  it('GET /webhook/orcamento/aprovar deve aprovar OS com token valido', async () => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);
    const token = await gerarTokenWebhook(os.getId(), 'aprovar');

    await request(app.getHttpServer())
      .get(`/webhook/orcamento/aprovar?token=${encodeURIComponent(token)}`)
      .expect(200);

    const osAtualizada = await osRepo.findById(os.getId());
    expect(osAtualizada?.orcamentoAprovado).toBe(true);
    expect(osAtualizada?.status).toBe(StatusOS.AGUARDANDO_APROVACAO);
  });

  it('GET /webhook/orcamento/recusar deve cancelar OS com token valido', async () => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);
    const token = await gerarTokenWebhook(os.getId(), 'recusar');

    await request(app.getHttpServer())
      .get(`/webhook/orcamento/recusar?token=${encodeURIComponent(token)}`)
      .expect(200);

    const osAtualizada = await osRepo.findById(os.getId());
    expect(osAtualizada?.status).toBe(StatusOS.CANCELADA);
  });

  it('GET /webhook/orcamento/aprovar deve retornar 400 com token de recusa', async () => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);
    const token = await gerarTokenWebhook(os.getId(), 'recusar');

    await request(app.getHttpServer())
      .get(`/webhook/orcamento/aprovar?token=${encodeURIComponent(token)}`)
      .expect(400);
  });

  it('GET /webhook/orcamento/recusar deve retornar 400 com token de aprovacao', async () => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);
    const token = await gerarTokenWebhook(os.getId(), 'aprovar');

    await request(app.getHttpServer())
      .get(`/webhook/orcamento/recusar?token=${encodeURIComponent(token)}`)
      .expect(400);
  });

  it('GET /webhook/orcamento/aprovar deve retornar 401 com token expirado', async () => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);
    const token = await gerarTokenWebhook(os.getId(), 'aprovar', '-1s');

    await request(app.getHttpServer())
      .get(`/webhook/orcamento/aprovar?token=${encodeURIComponent(token)}`)
      .expect(401);
  });

  it('GET /webhook/orcamento/recusar deve retornar 401 com token malformado', async () => {
    await request(app.getHttpServer())
      .get('/webhook/orcamento/recusar?token=token-invalido')
      .expect(401);
  });
});
