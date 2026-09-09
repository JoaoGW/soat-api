export class EntidadeEmUsoNaoPodeSerRemovidaError extends Error {
  constructor() {
    super('Entidade em uso nao pode ser removida.');
    this.name = 'EntidadeEmUsoNaoPodeSerRemovidaError';
  }
}
