import './infrastructure/observability/instrumentation';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('OS Service — Sistema Integrado de Oficina')
    .setDescription(
      'OS Service da Fase 4: abertura da ordem de serviço, cadastros de clientes e veículos, consulta de status e histórico e orquestração da Saga (Billing e Execution via Azure Service Bus). As rotas legadas das Fases 1–3 só aparecem com ENABLE_LEGACY_OFICINA=true.',
    )
    .setVersion('4.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT_ADMIN',
        description: 'Informe o token JWT recebido no login administrativo.',
        in: 'header',
      },
      'JWT_ADMIN',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT_CLIENTE',
        description:
          'Informe o token JWT emitido pela autenticacao CPF para o cliente.',
        in: 'header',
      },
      'JWT_CLIENTE',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        name: 'INTEGRACAO_INTERNA',
        description: 'Credencial exclusiva da integração de validação de CPF.',
        in: 'header',
      },
      'INTEGRACAO_INTERNA',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });

  await app.listen(3000);
}
bootstrap();
