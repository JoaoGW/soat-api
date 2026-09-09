import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LoginUseCase } from '../../../application/use-cases/auth/LoginUseCase';
import { AuthController } from './AuthController';

describe('AuthController', () => {
  let app: INestApplication;
  const loginUseCase = {
    execute: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: LoginUseCase,
          useValue: loginUseCase,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('deve retornar accessToken para payload valido', async () => {
    loginUseCase.execute.mockResolvedValue({ accessToken: 'token-123' });

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'admin',
        password: 'Admin@123456',
      })
      .expect(200);

    expect(response.body).toEqual({ accessToken: 'token-123' });
  });

  it('deve rejeitar payload com campo extra', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'admin',
        password: 'Admin@123456',
        extra: 'campo-nao-permitido',
      })
      .expect(400);
  });

  it('deve rejeitar password muito curta', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'admin',
        password: '123',
      })
      .expect(400);
  });

  it('deve rejeitar password muito longa', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'admin',
        password: 'a'.repeat(129),
      })
      .expect(400);
  });
});
