import { Injectable } from '@nestjs/common';
import { Peca } from '../../domain/entities/Peca';
import { PecaRepository } from '../../domain/repositories/PecaRepository';
import { ActiveFilter } from '../../domain/repositories/types';
import { PrismaService } from '../database/PrismaService';
import { PecaMapper } from '../mappers/PecaMapper';

@Injectable()
export class PrismaPecaRepository implements PecaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(peca: Peca): Promise<void> {
    await this.prisma.peca.upsert({
      where: { id: peca.getId() },
      create: {
        id: peca.getId(),
        nome: peca.nome,
        preco: peca.preco.centavos,
        quantidadeEstoque: peca.quantidadeEstoque,
        ativo: peca.ativo,
      },
      update: {
        nome: peca.nome,
        preco: peca.preco.centavos,
        quantidadeEstoque: peca.quantidadeEstoque,
        ativo: peca.ativo,
      },
    });
  }

  async findById(id: string): Promise<Peca | null> {
    const pecaData = await this.prisma.peca.findUnique({ where: { id } });
    if (!pecaData) return null;
    return PecaMapper.toDomain(pecaData);
  }

  async findAll(params?: ActiveFilter): Promise<Peca[]> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const pecasData = await this.prisma.peca.findMany({
      where: {
        ativo: params?.ativo ?? true,
      },
      skip: (page - 1) * limit,
      take: limit,
    });
    return pecasData.map((pecaData) => PecaMapper.toDomain(pecaData));
  }
}
