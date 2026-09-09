import { DomainError } from '../../shared/domain/DomainError';

export class ValorMonetarioInvalidoError extends DomainError {
  constructor() {
    super(`O valor inserido eh inválido`);
  }
}
