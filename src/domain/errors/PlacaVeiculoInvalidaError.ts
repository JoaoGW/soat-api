import { DomainError } from '../../shared/domain/DomainError';

export class PlacaVeiculoInvalidaError extends DomainError {
  constructor() {
    super(`A placa do veículo é inváida`);
  }
}
