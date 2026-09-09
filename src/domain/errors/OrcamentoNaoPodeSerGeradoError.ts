import { DomainError } from '../../shared/domain/DomainError';

export class OrcamentoNaoPodeSerGeradoError extends DomainError {
  constructor() {
    super(`Ocorreu um erro ao tentar gerar o seu orçamento`);
  }
}
