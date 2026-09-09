import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OrdemDeServico } from '../../src/domain/entities/OrdemDeServico';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';
import { PrismaOrdemDeServicoRepository } from '../../src/infrastructure/repositories/PrismaOrdemDeServicoRepository';
import { criarAppDeTeste } from '../helpers/criarAppDeTeste';
import {
  criarDependenciasParaOS,
  limparBancoDeTeste,
} from '../helpers/limparBancoDeTeste';

describe('Consulta Publica (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let osRepo: PrismaOrdemDeServicoRepository;

  beforeAll(async () => {
    app = await criarAppDeTeste();
    prisma = app.get(PrismaService);
    osRepo = app.get(PrismaOrdemDeServicoRepository);
  });

  beforeEach(async () => {
    await limparBancoDeTeste(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('codigo inexistente sem token deve retornar 404 e nunca 401', async () => {
    await request(app.getHttpServer())
      .get('/consulta/os/OS-2026-ABCDEF/status')
      .expect(404);
  });

  it('deve consultar status por codigo sem JWT', async () => {
    const os = OrdemDeServico.criar('cliente-1', 'veiculo-1');
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    const response = await request(app.getHttpServer())
      .get(`/consulta/os/${os.codigoAcompanhamento.valor}/status`)
      .expect(200);

    expect(response.body).toEqual({
      codigoAcompanhamento: os.codigoAcompanhamento.valor,
      status: 'RECEBIDA',
      descricaoStatus: 'Sua ordem de servico foi recebida pela oficina.',
      dataAtualizacao: expect.any(String),
    });
  });

  it('resposta publica nao deve expor dados internos da OS', async () => {
    const os = OrdemDeServico.criar('cliente-2', 'veiculo-2');
    await criarDependenciasParaOS(prisma, [os]);
    await osRepo.save(os);

    const response = await request(app.getHttpServer())
      .get(`/consulta/os/${os.codigoAcompanhamento.valor}/status`)
      .expect(200);

    expect(response.body).not.toHaveProperty('clienteId');
    expect(response.body).not.toHaveProperty('veiculoId');
    expect(response.body).not.toHaveProperty('valorTotal');
    expect(response.body).not.toHaveProperty('itens');
    expect(response.body).not.toHaveProperty('servicos');
  });
});
