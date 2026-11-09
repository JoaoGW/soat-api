import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { PrismaClienteRepository } from '../../../infrastructure/repositories/PrismaClienteRepository';
import { ClienteIntegracaoController } from './ClienteIntegracaoController';

describe('consulta interna de cliente por HTTP', () => {
  let app: INestApplication;
  const token = 'segredo-de-integracao-independente-e-longo';
  const jwtSecret = 'segredo-jwt-de-teste-com-mais-de-32-bytes';
  const repo = { findByDocumento: jest.fn() };

  beforeAll(async () => {
    process.env.INTERNAL_CLIENT_LOOKUP_TOKEN = token;
    const moduleRef = await Test.createTestingModule({
      controllers: [ClienteIntegracaoController],
      providers: [{ provide: PrismaClienteRepository, useValue: repo }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    delete process.env.INTERNAL_CLIENT_LOOKUP_TOKEN;
    await app.close();
  });

  beforeEach(() => repo.findByDocumento.mockReset());

  it('rejeita JWTs válidos e credenciais incorretas', async () => {
    const clientJwt = jwt.sign({ sub: 'cliente', role: 'cliente' }, jwtSecret);
    const adminJwt = jwt.sign({ sub: 'admin', role: 'admin' }, jwtSecret);
    for (const credential of [clientJwt, adminJwt, 'invalido']) {
      await request(app.getHttpServer())
        .post('/internal/clientes/validar-cpf')
        .set('Authorization', `Bearer ${credential}`)
        .send({ cpf: '52998224725' })
        .expect(401);
    }
    expect(repo.findByDocumento).not.toHaveBeenCalled();
  });

  it('entrega somente campos mínimos para integração autenticada', async () => {
    repo.findByDocumento.mockResolvedValue({
      getId: () => 'id-1',
      ativo: true,
      nome: 'privado',
    });
    const response = await request(app.getHttpServer())
      .post('/internal/clientes/validar-cpf')
      .set('Authorization', `Bearer ${token}`)
      .send({ cpf: '52998224725' })
      .expect(200);
    expect(response.body).toEqual({ cliente: { id: 'id-1', ativo: true } });
  });
});
