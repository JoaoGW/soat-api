import { randomBytes } from 'node:crypto';
import { ValueObject } from '../../shared/domain/ValueObject';
import { CodigoAcompanhamentoInvalidoError } from '../errors/CodigoAcompanhamentoInvalidoError';

interface CodigoAcompanhamentoProps {
  valor: string;
}

export class CodigoAcompanhamento extends ValueObject<CodigoAcompanhamentoProps> {
  private static readonly PATTERN = /^OS-\d{4}-[A-Z0-9]{6}$/;

  private constructor(valor: string) {
    super({ valor });
  }

  static criar(valor: string): CodigoAcompanhamento {
    const normalizado = valor?.trim().toUpperCase();
    if (!normalizado || !CodigoAcompanhamento.PATTERN.test(normalizado)) {
      throw new CodigoAcompanhamentoInvalidoError();
    }
    return new CodigoAcompanhamento(normalizado);
  }

  static gerar(): CodigoAcompanhamento {
    const ano = new Date().getFullYear();
    const random = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    return CodigoAcompanhamento.criar(`OS-${ano}-${random}`);
  }

  get valor(): string {
    return this.props.valor;
  }
}
