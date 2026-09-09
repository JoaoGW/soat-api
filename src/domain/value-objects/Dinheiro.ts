import { ValueObject } from '../../shared/domain/ValueObject';
import { ValorMonetarioInvalidoError } from '../errors/ValorMonetarioInvalidoError';

interface DinheiroProps {
  valorEmCentavos: number;
}

export class Dinheiro extends ValueObject<DinheiroProps> {
  constructor(valorEmCentavos: number) {
    if (valorEmCentavos < 0) throw new ValorMonetarioInvalidoError();
    super({ valorEmCentavos });
  }

  get centavos(): number {
    return this.props.valorEmCentavos;
  }

  somar(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.centavos + outro.centavos);
  }

  multiplicar(fator: number): Dinheiro {
    return new Dinheiro(Math.round(this.centavos * fator));
  }

  static zero(): Dinheiro {
    return new Dinheiro(0);
  }
}
