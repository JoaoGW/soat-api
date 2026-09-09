import { Module } from '@nestjs/common';
import { ObterTempoMedioExecucaoUseCase } from '../application/use-cases/ObterTempoMedioExecucaoUseCase';
import { PrismaOrdemDeServicoRepository } from '../infrastructure/repositories/PrismaOrdemDeServicoRepository';
import { RelatorioController } from '../interfaces/controllers/admin/RelatorioController';
import { JwtAuthGuard } from '../interfaces/guards/JwtAuthGuard';
import { AuthModule } from './auth.module';
import { RepositoryModule } from './repository.module';

@Module({
  imports: [RepositoryModule, AuthModule],
  controllers: [RelatorioController],
  providers: [
    JwtAuthGuard,
    {
      provide: ObterTempoMedioExecucaoUseCase,
      useFactory: (repo: PrismaOrdemDeServicoRepository) =>
        new ObterTempoMedioExecucaoUseCase(repo),
      inject: [PrismaOrdemDeServicoRepository],
    },
  ],
})
export class RelatorioModule {}
