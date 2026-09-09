import { DomainError } from '../../shared/domain/DomainError';

export class DocumentoInvalidoError extends DomainError {
  constructor() {
    super(`Documento inserido eh invalido`);
  }
}
