import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import {
  Phase4InternalClientController,
  Phase4RegistryRuntime,
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
});
