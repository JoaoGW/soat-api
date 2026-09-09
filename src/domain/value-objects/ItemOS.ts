import { ValueObject } from '../../shared/domain/ValueObject';
import { Dinheiro } from './Dinheiro';
import { Quantidade } from './Quantidade';

interface ItemOSProps {
  pecaId: string;
  quantidade: Quantidade;
  precoUnitario: Dinheiro;
}

export class ItemOS extends ValueObject<ItemOSProps> {
  constructor(pecaId: string, quantidade: Quantidade, precoUnitario: Dinheiro) {
    super({ pecaId, quantidade, precoUnitario });
  }

  get pecaId(): string {
    return this.props.pecaId;
  }
  get quantidade(): Quantidade {
    return this.props.quantidade;
  }
  get precoUnitario(): Dinheiro {
    return this.props.precoUnitario;
  }

  get subtotal(): Dinheiro {
    return this.props.precoUnitario.multiplicar(this.props.quantidade.valor);
  }
}
