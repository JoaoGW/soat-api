import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';
import { autenticarAdmin } from '../helpers/autenticarAdmin';
import { criarAppDeTeste } from '../helpers/criarAppDeTeste';
import { limparBancoDeTeste } from '../helpers/limparBancoDeTeste';

describe('Clientes (e2e)', () => {
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
      .post('/clientes')
      .send({
        nome: 'Sem Token',
        documento: '52998224725',
        contato: 'sem-token@email.com',
      })
      .expect(401);
  });

  it('deve executar CRUD administrativo de clientes', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/clientes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Cliente E2E',
        documento: '52998224725',
        contato: 'cliente@email.com',
      })
      .expect(201);

    const clienteId = createResponse.body.id as string;
    expect(typeof clienteId).toBe('string');

    const listarResponse = await request(app.getHttpServer())
      .get('/clientes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(listarResponse.body)).toBe(true);
    expect(listarResponse.body).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/clientes/${clienteId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const porDocumentoResponse = await request(app.getHttpServer())
      .get('/clientes')
      .query({ documento: '52998224725' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(porDocumentoResponse.body.id.value).toBe(clienteId);

    await request(app.getHttpServer())
      .put(`/clientes/${clienteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Cliente E2E Atualizado', contato: 'novo@email.com' })
      .expect(200);

    const clienteAtualizado = await request(app.getHttpServer())
      .get(`/clientes/${clienteId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(clienteAtualizado.body.props.nome).toBe('Cliente E2E Atualizado');

    await request(app.getHttpServer())
      .delete(`/clientes/${clienteId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const listaFinal = await request(app.getHttpServer())
      .get('/clientes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listaFinal.body).toHaveLength(0);
  });
});
