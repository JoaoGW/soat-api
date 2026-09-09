import { DomainError } from '../../shared/domain/DomainError';

export class QuantidadeInvalidaError extends DomainError {
  constructor(qtd: number) {
    super(`A quantidade de ${String(qtd)} inserida é inválida`);
  }
}
