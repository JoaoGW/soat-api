import { DomainError } from '../../shared/domain/DomainError';

export class ExecucaoNaoPodeSerIniciadaError extends DomainError {
  constructor() {
    super(`A execução não pode ser inciiada por um erro`);
  }
}
