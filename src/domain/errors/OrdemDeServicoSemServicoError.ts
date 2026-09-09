import { DomainError } from '../../shared/domain/DomainError';

export class OrdemDeServicoSemServicoError extends DomainError {
  constructor() {
    super(`Serviço Indisponível para Gerar a Ordem de Serviço`);
  }
}
