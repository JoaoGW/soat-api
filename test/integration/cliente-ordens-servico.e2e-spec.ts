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

describe('Cliente - Ordens de Servico (e2e)', () => {
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

  async function tokenCliente(
    clienteId: string,
    options?: { issuer?: string; audience?: string; role?: string },
  ): Promise<string> {
    return jwtService.signAsync(
      {
        sub: clienteId,
        cpf: '52998224725',
        role: options?.role ?? 'cliente',
      },
      {
        secret: process.env.JWT_CLIENT_SECRET,
        issuer: options?.issuer ?? process.env.JWT_CLIENT_ISSUER,
        audience: options?.audience ?? process.env.JWT_CLIENT_AUDIENCE,
        expiresIn: '15m',
      },
    );
  }

  function criarOSEmAguardandoAprovacao(
    clienteId = 'cliente-1',
    veiculoId = 'veiculo-1',
  ): OrdemDeServico {
    const os = OrdemDeServico.criar(clienteId, veiculoId);
    os.iniciarDiagnostico();
    os.adicionarServico('servico-1', new Dinheiro(10000));
    os.gerarOrcamento();
    os.enviarOrcamentoParaAprovacao();
    return os;
  }

  it('remove a consulta publica por codigo de acompanhamento', async () => {
    await request(app.getHttpServer())
      .get('/consulta/os/OS-2026-ABCDEF/status')
      .expect(404);
  });

  it('rejeita consulta de cliente sem token', async () => {
    await request(app.getHttpServer())
      .get('/cliente/ordens-servico/os-1')
      .expect(401);
  });

  it('permite ao cliente consultar a propria OS', async () => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    const response = await request(app.getHttpServer())
      .get(`/cliente/ordens-servico/${os.getId()}`)
      .set('Authorization', `Bearer ${await tokenCliente('cliente-1')}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: os.getId(),
      codigoAcompanhamento: os.codigoAcompanhamento.valor,
      status: StatusOS.AGUARDANDO_APROVACAO,
      orcamentoGerado: true,
      orcamentoAprovado: false,
    });
  });

  it('permite ao cliente aprovar o orcamento da propria OS', async () => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    await request(app.getHttpServer())
      .post(`/cliente/ordens-servico/${os.getId()}/aprovar-orcamento`)
      .set('Authorization', `Bearer ${await tokenCliente('cliente-1')}`)
      .expect(200);

    const osAtualizada = await osRepo.findById(os.getId());
    expect(osAtualizada?.orcamentoAprovado).toBe(true);
  });

  it('permite ao cliente recusar o orcamento da propria OS', async () => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    await request(app.getHttpServer())
      .post(`/cliente/ordens-servico/${os.getId()}/recusar-orcamento`)
      .set('Authorization', `Bearer ${await tokenCliente('cliente-1')}`)
      .expect(200);

    const osAtualizada = await osRepo.findById(os.getId());
    expect(osAtualizada?.status).toBe(StatusOS.CANCELADA);
  });

  it('rejeita acesso de cliente a OS de terceiro sem alterar a ordem', async () => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    await request(app.getHttpServer())
      .post(`/cliente/ordens-servico/${os.getId()}/recusar-orcamento`)
      .set('Authorization', `Bearer ${await tokenCliente('cliente-2')}`)
      .expect(403);

    const osAtualizada = await osRepo.findById(os.getId());
    expect(osAtualizada?.status).toBe(StatusOS.AGUARDANDO_APROVACAO);
  });

  it.each([
    ['issuer incorreto', { issuer: 'issuer-incorreto' }],
    ['audience incorreta', { audience: 'audience-incorreta' }],
    ['papel administrativo', { role: 'admin' }],
  ])('rejeita token de cliente com %s', async (_descricao, options) => {
    const os = criarOSEmAguardandoAprovacao();
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    await request(app.getHttpServer())
      .get(`/cliente/ordens-servico/${os.getId()}`)
      .set(
        'Authorization',
        `Bearer ${await tokenCliente('cliente-1', options)}`,
      )
      .expect(401);
  });
});
