import { DomainError } from '../../shared/domain/DomainError';

export class CodigoAcompanhamentoInvalidoError extends DomainError {
  constructor() {
    super('Codigo de acompanhamento invalido');
  }
}
