import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';
import { autenticarAdmin } from '../helpers/autenticarAdmin';
import { criarAppDeTeste } from '../helpers/criarAppDeTeste';
import { limparBancoDeTeste } from '../helpers/limparBancoDeTeste';

describe('Veiculos (e2e)', () => {
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

  async function criarCliente(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/clientes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Cliente Veiculo',
        documento: '04252011000110',
        contato: 'cliente-veiculo@email.com',
      })
      .expect(201);
    return response.body.id as string;
  }

  it('sem token deve retornar 401', async () => {
    await request(app.getHttpServer())
      .post('/veiculos')
      .send({
        clienteId: 'id',
        placa: 'ABC1D23',
        marca: 'Toyota',
        modelo: 'Corolla',
        ano: 2022,
      })
      .expect(401);
  });

  it('deve executar CRUD administrativo de veiculos', async () => {
    const clienteId = await criarCliente();

    const createResponse = await request(app.getHttpServer())
      .post('/veiculos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clienteId,
        placa: 'ABC1D23',
        marca: 'Toyota',
        modelo: 'Corolla',
        ano: 2022,
      })
      .expect(201);

    const veiculoId = createResponse.body.id as string;
    expect(typeof veiculoId).toBe('string');

    const listar = await request(app.getHttpServer())
      .get('/veiculos')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listar.body).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/veiculos/${veiculoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const porCliente = await request(app.getHttpServer())
      .get(`/veiculos/cliente/${clienteId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(porCliente.body).toHaveLength(1);

    await request(app.getHttpServer())
      .put(`/veiculos/${veiculoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        marca: 'Toyota',
        modelo: 'Corolla XEI',
        ano: 2023,
      })
      .expect(200);

    const atualizado = await request(app.getHttpServer())
      .get(`/veiculos/${veiculoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(atualizado.body.props.modelo).toBe('Corolla XEI');

    await request(app.getHttpServer())
      .delete(`/veiculos/${veiculoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const listaFinal = await request(app.getHttpServer())
      .get('/veiculos')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listaFinal.body).toHaveLength(0);
  });
});
