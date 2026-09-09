import { Injectable } from '@nestjs/common';
import { Veiculo } from '../../domain/entities/Veiculo';
import { VeiculoRepository } from '../../domain/repositories/VeiculoRepository';
import { ActiveFilter } from '../../domain/repositories/types';
import { PrismaService } from '../database/PrismaService';
import { VeiculoMapper } from '../mappers/VeiculoMapper';

@Injectable()
export class PrismaVeiculoRepository implements VeiculoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(veiculo: Veiculo): Promise<void> {
    await this.prisma.veiculo.upsert({
      where: { id: veiculo.getId() },
      create: {
        id: veiculo.getId(),
        clienteId: veiculo.clienteId,
        placa: veiculo.placa.valor,
        marca: veiculo.marca,
        modelo: veiculo.modelo,
        ano: veiculo.ano,
        ativo: veiculo.ativo,
      },
      update: {
        marca: veiculo.marca,
        modelo: veiculo.modelo,
        ano: veiculo.ano,
        ativo: veiculo.ativo,
      },
    });
  }

  async findById(id: string): Promise<Veiculo | null> {
    const veiculoData = await this.prisma.veiculo.findUnique({
      where: { id },
    });
    if (!veiculoData) return null;
    return VeiculoMapper.toDomain(veiculoData);
  }

  async findByPlaca(placa: string): Promise<Veiculo | null> {
    const veiculoData = await this.prisma.veiculo.findUnique({
      where: { placa },
    });
    if (!veiculoData) return null;
    return VeiculoMapper.toDomain(veiculoData);
  }

  async findByClienteId(
    clienteId: string,
    params?: { ativo?: boolean },
  ): Promise<Veiculo[]> {
    const veiculosData = await this.prisma.veiculo.findMany({
      where: {
        clienteId,
        ativo: params?.ativo ?? true,
      },
    });
    return veiculosData.map((veiculoData) =>
      VeiculoMapper.toDomain(veiculoData),
    );
  }

  async findAll(params?: ActiveFilter): Promise<Veiculo[]> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const veiculosData = await this.prisma.veiculo.findMany({
      where: {
        ativo: params?.ativo ?? true,
      },
      skip: (page - 1) * limit,
      take: limit,
    });
    return veiculosData.map((veiculoData) =>
      VeiculoMapper.toDomain(veiculoData),
    );
  }
}
