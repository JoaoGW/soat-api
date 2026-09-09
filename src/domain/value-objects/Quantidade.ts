import { ValueObject } from '../../shared/domain/ValueObject';
import { QuantidadeInvalidaError } from '../errors/QuantidadeInvalidaError';

interface QuantidadeProps {
  valor: number;
}

export class Quantidade extends ValueObject<QuantidadeProps> {
  constructor(valor: number) {
    if (valor <= 0 || !Number.isInteger(valor))
      throw new QuantidadeInvalidaError(valor);
    super({ valor });
  }

  get valor(): number {
    return this.props.valor;
  }
}
