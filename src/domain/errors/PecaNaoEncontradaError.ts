export class PecaNaoEncontradaError extends Error {
  constructor() {
    super('Peca nao encontrada.');
    this.name = 'PecaNaoEncontradaError';
  }
}
