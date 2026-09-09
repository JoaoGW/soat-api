import { Veiculo } from '../../domain/entities/Veiculo';
import { PlacaVeiculo } from '../../domain/value-objects/PlacaVeiculo';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';

export class VeiculoMapper {
  static toDomain(veiculoData: any): Veiculo {
    return new Veiculo(
      {
        clienteId: veiculoData.clienteId,
        placa: new PlacaVeiculo(veiculoData.placa),
        marca: veiculoData.marca,
        modelo: veiculoData.modelo,
        ano: veiculoData.ano,
        ativo: veiculoData.ativo ?? true,
        dataCriacao: veiculoData.createdAt
          ? new Date(veiculoData.createdAt)
          : new Date(),
        dataAtualizacao: veiculoData.updatedAt
          ? new Date(veiculoData.updatedAt)
          : new Date(),
      },
      new UniqueEntityId(veiculoData.id),
    );
  }
}
