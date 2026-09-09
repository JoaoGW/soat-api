import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';
import { autenticarAdmin } from '../helpers/autenticarAdmin';
import { criarAppDeTeste } from '../helpers/criarAppDeTeste';
import { limparBancoDeTeste } from '../helpers/limparBancoDeTeste';

describe('Pecas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    app = await criarAppDeTeste();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await limparBancoDeTeste(prisma);
    token = await autenticarAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem token deve retornar 401', async () => {
    await request(app.getHttpServer())
      .post('/pecas')
      .send({
        nome: 'Filtro de oleo',
        precoEmCentavos: 4500,
        quantidadeEstoque: 10,
      })
      .expect(401);
  });

  it('deve executar CRUD administrativo de pecas', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/pecas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Filtro de oleo',
        precoEmCentavos: 4500,
        quantidadeEstoque: 10,
      })
      .expect(201);

    const pecaId = createResponse.body.id as string;
    expect(typeof pecaId).toBe('string');

    const listar = await request(app.getHttpServer())
      .get('/pecas')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listar.body).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/pecas/${pecaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .put(`/pecas/${pecaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Filtro premium',
        precoEmCentavos: 5000,
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/pecas/${pecaId}/estoque`)
      .set('Authorization', `Bearer ${token}`)
      .send({ novaQuantidade: 20 })
      .expect(200);

    const atualizada = await request(app.getHttpServer())
      .get(`/pecas/${pecaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(atualizada.body.props.nome).toBe('Filtro premium');
    expect(atualizada.body.props.quantidadeEstoque.props.valor).toBe(20);

    await request(app.getHttpServer())
      .delete(`/pecas/${pecaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const listaFinal = await request(app.getHttpServer())
      .get('/pecas')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listaFinal.body).toHaveLength(0);
  });
});
