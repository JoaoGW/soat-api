import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';
import { autenticarAdmin } from '../helpers/autenticarAdmin';
import { criarAppDeTeste } from '../helpers/criarAppDeTeste';
import { limparBancoDeTeste } from '../helpers/limparBancoDeTeste';

describe('Servicos (e2e)', () => {
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
      .post('/servicos')
      .send({
        nome: 'Troca de oleo',
        descricao: 'Teste',
        precoEmCentavos: 10000,
      })
      .expect(401);
  });

  it('deve executar CRUD administrativo de servicos', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/servicos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Troca de oleo',
        descricao: 'Troca completa',
        precoEmCentavos: 15000,
      })
      .expect(201);

    const servicoId = createResponse.body.id as string;
    expect(typeof servicoId).toBe('string');

    const listar = await request(app.getHttpServer())
      .get('/servicos')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listar.body).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/servicos/${servicoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .put(`/servicos/${servicoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Troca de oleo premium',
        descricao: 'Troca com filtro',
        precoEmCentavos: 18000,
      })
      .expect(200);

    const atualizado = await request(app.getHttpServer())
      .get(`/servicos/${servicoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(atualizado.body.props.nome).toBe('Troca de oleo premium');

    await request(app.getHttpServer())
      .delete(`/servicos/${servicoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const listaFinal = await request(app.getHttpServer())
      .get('/servicos')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listaFinal.body).toHaveLength(0);
  });
});
