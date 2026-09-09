import { ValueObject } from '../../shared/domain/ValueObject';
import { Dinheiro } from './Dinheiro';

interface ItemServicoOSProps {
  servicoId: string;
  preco: Dinheiro;
}

export class ItemServicoOS extends ValueObject<ItemServicoOSProps> {
  constructor(servicoId: string, preco: Dinheiro) {
    super({ servicoId, preco });
  }

  get servicoId(): string {
    return this.props.servicoId;
  }

  get preco(): Dinheiro {
    return this.props.preco;
  }
}
