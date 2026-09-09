import { DomainError } from '../../shared/domain/DomainError';

export class TransicaoStatusInvalidaError extends DomainError {
  constructor(de: string, para: string) {
    super(`Transição inválida: de: ${de} para: ${para}`);
  }
}
