import { PlacaVeiculoInvalidaError } from '../errors/PlacaVeiculoInvalidaError';
import { PlacaVeiculo } from './PlacaVeiculo';

describe('PlacaVeiculo', () => {
  it('deve aceitar placa no padrao antigo', () => {
    const placa = new PlacaVeiculo('ABC-1234');

    expect(placa.valor).toBe('ABC1234');
  });

  it('deve aceitar placa Mercosul', () => {
    const placa = new PlacaVeiculo('BRA1A23');

    expect(placa.valor).toBe('BRA1A23');
  });

  it('deve rejeitar placa invalida', () => {
    expect(() => new PlacaVeiculo('AB-1234')).toThrow(
      PlacaVeiculoInvalidaError,
    );
  });
});
