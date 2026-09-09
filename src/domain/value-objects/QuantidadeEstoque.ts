import { ValueObject } from '../../shared/domain/ValueObject';
import { QuantidadeEstoqueInvalidaError } from '../errors/QuantidadeEstoqueInvalidaError';

interface QuantidadeEstoqueProps {
  valor: number;
}

export class QuantidadeEstoque extends ValueObject<QuantidadeEstoqueProps> {
  constructor(valor: number) {
    if (valor < 0 || !Number.isInteger(valor)) {
      throw new QuantidadeEstoqueInvalidaError(valor);
    }
    super({ valor });
  }

  get valor(): number {
    return this.props.valor;
  }
}
