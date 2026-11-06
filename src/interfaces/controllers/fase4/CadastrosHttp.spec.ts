import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { JwtStrategy } from '../../strategies/JwtStrategy';
import { JwtClienteStrategy } from '../../strategies/JwtClienteStrategy';
import {
  Phase4InternalClientController,
  Phase4RegistryRuntime,
  Phase4AdminOrderQueryController,
  Phase4CustomerOrderQueryController,
} from './CadastrosController';

describe('consulta de cliente interno da Fase 4', () => {
  let app: INestApplication;
  const token = 'segredo-de-integracao-exclusivo-mais-de-32';
  const secret = 'segredo-jwt-de-teste-com-mais-de-32-bytes';
  const old = process.env;
  const registry = { lookupCpf: jest.fn() };
  beforeAll(async () => {
    process.env = {
      ...old,
      INTERNAL_CLIENT_LOOKUP_TOKEN: token,
      JWT_SECRET: secret,
      JWT_CLIENT_SECRET: 'outro-segredo-com-mais-de-32-bytes',
    };
    const module = await Test.createTestingModule({
      controllers: [Phase4InternalClientController],
      providers: [
        {
          provide: Phase4RegistryRuntime,
          useValue: { registry: () => registry },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    process.env = old;
    await app.close();
  });
  beforeEach(() => jest.resetAllMocks());
  it('rejeita JWT administrativo e de cliente e não consulta o banco', async () => {
    for (const role of ['admin', 'cliente']) {
      const credential = jwt.sign({ sub: 'x', role }, secret, {
        expiresIn: '1h',
      });
      await request(app.getHttpServer())
        .post('/fase4/internal/clientes/validar-cpf')
        .set('Authorization', `Bearer ${credential}`)
        .send({ cpf: '52998224725' })
        .expect(401);
    }
    expect(registry.lookupCpf).not.toHaveBeenCalled();
  });
  it('entrega somente resultado mínimo a integração autenticada', async () => {
    registry.lookupCpf.mockResolvedValue({
      cliente: { id: 'id-1', ativo: false },
    });
    const response = await request(app.getHttpServer())
      .post('/fase4/internal/clientes/validar-cpf')
      .set('Authorization', `Bearer ${token}`)
      .send({ cpf: '52998224725' })
      .expect(200);
    expect(response.body).toEqual({ cliente: { id: 'id-1', ativo: false } });
    await request(app.getHttpServer())
      .post('/fase4/internal/clientes/validar-cpf')
      .set('Authorization', `Bearer ${token}`)
      .send({ cpf: '52998224725', extra: true })
      .expect(400);
  });
  it('documenta a credencial exclusiva e o contrato mínimo da integração', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'INTEGRACAO_INTERNA')
        .build(),
    );
    const operation =
      document.paths['/fase4/internal/clientes/validar-cpf'].post!;
    expect(operation.security).toEqual([{ INTEGRACAO_INTERNA: [] }]);
    expect(operation.requestBody).toMatchObject({
      content: { 'application/json': { schema: { required: ['cpf'] } } },
    });
    expect(operation.responses['200']).toMatchObject({
      content: { 'application/json': { schema: { required: ['cliente'] } } },
    });
  });
});

describe('consultas de ordens com JWT real', () => {
  let app: INestApplication;
  const customerSecret = 'segredo-cliente-para-teste-maior-que-32';
  const adminSecret = 'segredo-admin-para-teste-maior-que-32';
  const orders = {
    list: jest.fn(),
    get: jest.fn(),
    history: jest.fn(),
    saga: jest.fn(),
  };
  beforeAll(async () => {
    const values: Record<string, string> = {
      JWT_CLIENT_SECRET: customerSecret,
      JWT_SECRET: adminSecret,
      JWT_CLIENT_ISSUER: 'soat-auth-function',
      JWT_CLIENT_AUDIENCE: 'soat-api',
    };
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [
        Phase4AdminOrderQueryController,
        Phase4CustomerOrderQueryController,
      ],
      providers: [
        JwtStrategy,
        JwtClienteStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => values[key] },
        },
        { provide: Phase4RegistryRuntime, useValue: { orders: () => orders } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    orders.get.mockResolvedValue({ id: 'os-1' });
    orders.list.mockResolvedValue({ items: [] });
  });
  it('usa o sujeito assinado e rejeita acesso do cliente à rota administrativa', async () => {
    const token = jwt.sign(
      { sub: 'cliente-a', cpf: '52998224725', role: 'cliente' },
      customerSecret,
      { issuer: 'soat-auth-function', audience: 'soat-api', expiresIn: '1h' },
    );
    await request(app.getHttpServer())
      .get('/fase4/cliente/ordens-servico/os-1?clienteId=cliente-b')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(orders.get).toHaveBeenCalledWith('os-1', 'cliente-a');
    await request(app.getHttpServer())
      .get('/fase4/ordens-servico')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/fase4/cliente/ordens-servico')
      .expect(401);
  });
  it('rejeita JWT de administrador na rota de cliente', async () => {
    const token = jwt.sign({ sub: 'admin', role: 'admin' }, adminSecret, {
      expiresIn: '1h',
    });
    await request(app.getHttpServer())
      .get('/fase4/cliente/ordens-servico')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
