import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ORCAMENTO_WEBHOOK_TOKEN_PORT } from '../application/ports/output/PortTokens';
import { AprovarOrcamentoUseCase } from '../application/use-cases/AprovarOrcamentoUseCase';
import { RecusarOrcamentoUseCase } from '../application/use-cases/RecusarOrcamentoUseCase';
import { JwtOrcamentoWebhookTokenAdapter } from '../infrastructure/adapters/webhook/JwtOrcamentoWebhookTokenAdapter';
import { PrismaOrdemDeServicoRepository } from '../infrastructure/repositories/PrismaOrdemDeServicoRepository';
import { WebhookOrcamentoController } from '../interfaces/controllers/publico/WebhookOrcamentoController';
import { AuthModule } from './auth.module';
import { RepositoryModule } from './repository.module';

@Module({
  imports: [ConfigModule, RepositoryModule, AuthModule],
  controllers: [WebhookOrcamentoController],
  providers: [
    JwtOrcamentoWebhookTokenAdapter,
    {
      provide: ORCAMENTO_WEBHOOK_TOKEN_PORT,
      useExisting: JwtOrcamentoWebhookTokenAdapter,
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
