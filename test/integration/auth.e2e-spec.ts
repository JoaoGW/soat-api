import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';
import { autenticarAdmin } from '../helpers/autenticarAdmin';
import { criarAppDeTeste } from '../helpers/criarAppDeTeste';
import { limparBancoDeTeste } from '../helpers/limparBancoDeTeste';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await criarAppDeTeste();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await limparBancoDeTeste(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/login com credenciais validas deve retornar accessToken', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'admin',
        password: 'admin12345',
      })
      .expect(200);

    expect(typeof response.body.accessToken).toBe('string');
    expect(response.body.accessToken.length).toBeGreaterThan(10);
  });

  it('POST /auth/login com username invalido deve retornar 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'invalido',
        password: 'admin12345',
      })
      .expect(401);
  });

  it('POST /auth/login com senha invalida deve retornar 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'admin',
        password: 'senha-invalida',
      })
      .expect(401);
  });

  it('POST /auth/login com campo extra deve retornar 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'admin',
        password: 'admin12345',
        extra: 'nao-permitido',
      })
      .expect(400);
  });

  it('POST /auth/login com senha curta deve retornar 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'admin',
        password: '123',
      })
      .expect(400);
  });

  it('rota admin sem token deve retornar 401', async () => {
    await request(app.getHttpServer()).get('/clientes').expect(401);
  });

  it('rota admin com token valido deve funcionar', async () => {
    const token = await autenticarAdmin(app);

    await request(app.getHttpServer())
      .get('/clientes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('rota admin com token malformado deve retornar 401', async () => {
    await request(app.getHttpServer())
      .get('/clientes')
      .set('Authorization', 'Bearer token-malformado')
      .expect(401);
  });

  it('rota admin com token sem prefixo Bearer deve retornar 401', async () => {
    const token = await autenticarAdmin(app);

    await request(app.getHttpServer())
      .get('/clientes')
      .set('Authorization', token)
      .expect(401);
  });

  it('rota admin com token assinado com secret errado deve retornar 401', async () => {
    const jwtErrado = new JwtService({ secret: 'secret-errado' });
    const tokenErrado = await jwtErrado.signAsync({
      sub: 'admin',
      role: 'admin',
    });

    await request(app.getHttpServer())
      .get('/clientes')
      .set('Authorization', `Bearer ${tokenErrado}`)
      .expect(401);
  });

  it('rota admin com token sem role admin deve retornar 401', async () => {
    const jwt = new JwtService({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    });
    const tokenSemRoleAdmin = await jwt.signAsync({
      sub: 'admin',
      role: 'user',
    });

    await request(app.getHttpServer())
      .get('/clientes')
      .set('Authorization', `Bearer ${tokenSemRoleAdmin}`)
      .expect(401);
  });
});
