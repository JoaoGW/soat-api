import { Injectable } from '@nestjs/common';
import { Servico } from '../../domain/entities/Servico';
import { ServicoRepository } from '../../domain/repositories/ServicoRepository';
import { ActiveFilter } from '../../domain/repositories/types';
import { PrismaService } from '../database/PrismaService';
import { ServicoMapper } from '../mappers/ServicoMapper';

@Injectable()
export class PrismaServicoRepository implements ServicoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(servico: Servico): Promise<void> {
    await this.prisma.servico.upsert({
      where: { id: servico.getId() },
      create: {
        id: servico.getId(),
        nome: servico.nome,
        descricao: servico.descricao,
        preco: servico.preco.centavos,
        ativo: servico.ativo,
      },
      update: {
        nome: servico.nome,
        descricao: servico.descricao,
        preco: servico.preco.centavos,
        ativo: servico.ativo,
      },
    });
  }

  async findById(id: string): Promise<Servico | null> {
    const servicoData = await this.prisma.servico.findUnique({
      where: { id },
    });
    if (!servicoData) return null;
    return ServicoMapper.toDomain(servicoData);
  }

  async findAll(params?: ActiveFilter): Promise<Servico[]> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const servicosData = await this.prisma.servico.findMany({
      where: {
        ativo: params?.ativo ?? true,
      },
      skip: (page - 1) * limit,
      take: limit,
    });
    return servicosData.map((servicoData) =>
      ServicoMapper.toDomain(servicoData),
    );
  }
}
