import { Module } from '@nestjs/common';
import { PrismaService } from '../infrastructure/database/PrismaService';
import { PrismaClienteRepository } from '../infrastructure/repositories/PrismaClienteRepository';
import { PrismaOrdemDeServicoRepository } from '../infrastructure/repositories/PrismaOrdemDeServicoRepository';
import { PrismaPecaRepository } from '../infrastructure/repositories/PrismaPecaRepository';
import { PrismaServicoRepository } from '../infrastructure/repositories/PrismaServicoRepository';
import { PrismaVeiculoRepository } from '../infrastructure/repositories/PrismaVeiculoRepository';

@Module({
  providers: [
    PrismaService,
    PrismaClienteRepository,
    PrismaVeiculoRepository,
    PrismaServicoRepository,
    PrismaPecaRepository,
    PrismaOrdemDeServicoRepository,
  ],
  exports: [
    PrismaService,
    PrismaClienteRepository,
    PrismaVeiculoRepository,
    PrismaServicoRepository,
    PrismaPecaRepository,
    PrismaOrdemDeServicoRepository,
  ],
})
export class RepositoryModule {}
