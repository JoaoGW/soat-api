import { ValueObject } from '../../shared/domain/ValueObject';
import { PlacaVeiculoInvalidaError } from '../errors/PlacaVeiculoInvalidaError';

interface PlacaProps {
  valor: string;
}

export class PlacaVeiculo extends ValueObject<PlacaProps> {
  // padrão antigo: ABC-1234 | Mercosul: ABC1D23
  private static readonly REGEX =
    /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$|^[A-Z]{3}[0-9]{4}$/;

  constructor(valor: string) {
    const normalizado = valor.toUpperCase().replace('-', '');
    if (!PlacaVeiculo.REGEX.test(normalizado))
      throw new PlacaVeiculoInvalidaError();
    super({ valor: normalizado });
  }

  get valor(): string {
    return this.props.valor;
  }
}
