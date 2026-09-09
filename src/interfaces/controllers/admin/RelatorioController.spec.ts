import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { ConsultarStatusOSUseCase } from '../../../application/use-cases/ConsultarStatusOSUseCase';
import { ObterTempoMedioExecucaoUseCase } from '../../../application/use-cases/ObterTempoMedioExecucaoUseCase';
import { ConsultaPublicaController } from '../publico/ConsultaPublicaController';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';
import { JwtStrategy } from '../../strategies/JwtStrategy';
import { RelatorioController } from './RelatorioController';

describe('RelatorioController + JwtAuthGuard', () => {
  const TEST_SECRET = 'test-secret-for-jwt-validation-123456789012345';
  let app: INestApplication;

  const obterTempoMedio = {
    execute: jest.fn(),
  };

  const consultarStatus = {
    execute: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: TEST_SECRET,
            }),
          ],
        }),
        PassportModule,
      ],
      controllers: [RelatorioController, ConsultaPublicaController],
      providers: [
        JwtAuthGuard,
        JwtStrategy,
        {
          provide: ObterTempoMedioExecucaoUseCase,
          useValue: obterTempoMedio,
        },
        {
          provide: ConsultarStatusOSUseCase,
          useValue: consultarStatus,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    obterTempoMedio.execute.mockResolvedValue({
      mediaEmMinutos: 127,
      totalOSConsideradas: 42,
      etapas: {
        diagnostico: { mediaEmMinutos: 35, totalOSConsideradas: 42 },
        execucao: { mediaEmMinutos: 127, totalOSConsideradas: 42 },
        finalizacao: { mediaEmMinutos: 10, totalOSConsideradas: 40 },
      },
    });
    consultarStatus.execute.mockResolvedValue({
      codigoAcompanhamento: 'OS-2026-A8K92P',
      status: 'EM_EXECUCAO',
      descricaoStatus: 'Seu veiculo esta em execucao de servico.',
      dataAtualizacao: '2026-01-15T10:30:00.000Z',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('deve rejeitar rota admin sem token', async () => {
    await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .expect(401);
  });

  it('deve permitir rota admin com token valido', async () => {
    const token = jwt.sign({ sub: 'admin', role: 'admin' }, TEST_SECRET, {
      expiresIn: '1h',
    });

    const response = await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      mediaEmMinutos: 127,
      totalOSConsideradas: 42,
      etapas: {
        diagnostico: { mediaEmMinutos: 35, totalOSConsideradas: 42 },
        execucao: { mediaEmMinutos: 127, totalOSConsideradas: 42 },
        finalizacao: { mediaEmMinutos: 10, totalOSConsideradas: 40 },
      },
    });
  });

  it('deve rejeitar token expirado', async () => {
    const token = jwt.sign({ sub: 'admin', role: 'admin' }, TEST_SECRET, {
      expiresIn: -10,
    });

    await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('deve rejeitar token malformado', async () => {
    await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .set('Authorization', 'Bearer token.invalido')
      .expect(401);
  });

  it('deve rejeitar token sem prefixo Bearer', async () => {
    const token = jwt.sign({ sub: 'admin', role: 'admin' }, TEST_SECRET, {
      expiresIn: '1h',
    });

    await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .set('Authorization', token)
      .expect(401);
  });

  it('deve rejeitar token assinado com secret errado', async () => {
    const token = jwt.sign(
      { sub: 'admin', role: 'admin' },
      'wrong-secret-1234567890123456789012',
      { expiresIn: '1h' },
    );

    await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('deve rejeitar token sem role admin', async () => {
    const token = jwt.sign({ sub: 'admin', role: 'user' }, TEST_SECRET, {
      expiresIn: '1h',
    });

    await request(app.getHttpServer())
      .get('/relatorios/tempo-medio-execucao')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('deve manter rota publica acessivel sem token', async () => {
    await request(app.getHttpServer())
      .get('/consulta/os/OS-2026-A8K92P/status')
      .expect(200);
  });
});
