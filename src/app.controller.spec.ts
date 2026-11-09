import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'OTEL_SERVICE_VERSION' ? 'test' : 'soat-api',
            ),
          },
        },
      ],
    }).compile();
  });

  describe('getHello', () => {
    it('should return "Hello World!"', () => {
      const appController = app.get(AppController);
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  it('deve expor healthcheck sem dados sensíveis', () => {
    const appController = app.get(AppController);
    expect(appController.health()).toEqual({
      status: 'ok',
      service: 'soat-api',
      version: 'test',
    });
  });
});
