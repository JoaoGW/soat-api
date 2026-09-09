import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ORCAMENTO_WEBHOOK_TOKEN_PORT } from '../application/ports/output/PortTokens';
import { AprovarOrcamentoUseCase } from '../application/use-cases/AprovarOrcamentoUseCase';
import { ConsultarStatusOSUseCase } from '../application/use-cases/ConsultarStatusOSUseCase';
import { RecusarOrcamentoUseCase } from '../application/use-cases/RecusarOrcamentoUseCase';
import { JwtOrcamentoWebhookTokenAdapter } from '../infrastructure/adapters/webhook/JwtOrcamentoWebhookTokenAdapter';
import { PrismaOrdemDeServicoRepository } from '../infrastructure/repositories/PrismaOrdemDeServicoRepository';
import { ConsultaPublicaController } from '../interfaces/controllers/publico/ConsultaPublicaController';
import { WebhookOrcamentoController } from '../interfaces/controllers/publico/WebhookOrcamentoController';
import { AuthModule } from './auth.module';
import { RepositoryModule } from './repository.module';

@Module({
  imports: [ConfigModule, RepositoryModule, AuthModule],
  controllers: [ConsultaPublicaController, WebhookOrcamentoController],
  providers: [
    JwtOrcamentoWebhookTokenAdapter,
    {
      provide: ORCAMENTO_WEBHOOK_TOKEN_PORT,
      useExisting: JwtOrcamentoWebhookTokenAdapter,
    },
    {
      provide: ConsultarStatusOSUseCase,
      useFactory: (repo: PrismaOrdemDeServicoRepository) =>
        new ConsultarStatusOSUseCase(repo),
      inject: [PrismaOrdemDeServicoRepository],
    },
    {
      provide: AprovarOrcamentoUseCase,
      useFactory: (repo: PrismaOrdemDeServicoRepository) =>
        new AprovarOrcamentoUseCase(repo),
      inject: [PrismaOrdemDeServicoRepository],
    },
    {
      provide: RecusarOrcamentoUseCase,
      useFactory: (repo: PrismaOrdemDeServicoRepository) =>
        new RecusarOrcamentoUseCase(repo),
      inject: [PrismaOrdemDeServicoRepository],
    },
  ],
})
export class PublicoModule {}
