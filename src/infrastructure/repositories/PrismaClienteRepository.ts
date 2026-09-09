import { Injectable } from '@nestjs/common';
import { Cliente } from '../../domain/entities/Cliente';
import { ClienteRepository } from '../../domain/repositories/ClienteRepository';
import { ActiveFilter } from '../../domain/repositories/types';
import { PrismaService } from '../database/PrismaService';
import { ClienteMapper } from '../mappers/ClienteMapper';

@Injectable()
export class PrismaClienteRepository implements ClienteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(cliente: Cliente): Promise<void> {
    await this.prisma.cliente.upsert({
      where: { id: cliente.getId() },
      create: {
        id: cliente.getId(),
        nome: cliente.nome,
        documento: cliente.documento.valor,
        tipo: cliente.tipo,
        contato: cliente.contato,
        ativo: cliente.ativo,
      },
      update: {
        nome: cliente.nome,
        contato: cliente.contato,
        ativo: cliente.ativo,
      },
    });
  }

  async findById(id: string): Promise<Cliente | null> {
    const clienteData = await this.prisma.cliente.findUnique({
      where: { id },
    });
    if (!clienteData) return null;
    return ClienteMapper.toDomain(clienteData);
  }

  async findByDocumento(documento: string): Promise<Cliente | null> {
    const clienteData = await this.prisma.cliente.findUnique({
      where: { documento },
    });
    if (!clienteData) return null;
    return ClienteMapper.toDomain(clienteData);
  }

  async findAll(params?: ActiveFilter): Promise<Cliente[]> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const clientesData = await this.prisma.cliente.findMany({
      where: {
        ativo: params?.ativo ?? true,
      },
      skip: (page - 1) * limit,
      take: limit,
    });
    return clientesData.map((clienteData) =>
      ClienteMapper.toDomain(clienteData),
    );
  }
}
