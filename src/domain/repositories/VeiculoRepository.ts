import { Veiculo } from '../entities/Veiculo';
import { ActiveFilter } from './types';

export interface VeiculoRepository {
  save(veiculo: Veiculo): Promise<void>;
  findById(id: string): Promise<Veiculo | null>;
  findAll(params?: ActiveFilter): Promise<Veiculo[]>;
  findByClienteId(
    clienteId: string,
    params?: { ativo?: boolean },
  ): Promise<Veiculo[]>;
  findByPlaca(placa: string): Promise<Veiculo | null>;
}
