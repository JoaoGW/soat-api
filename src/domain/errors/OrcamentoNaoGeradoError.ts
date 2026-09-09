export class OrcamentoNaoGeradoError extends Error {
  constructor() {
    super('Orcamento ainda nao foi gerado.');
    this.name = 'OrcamentoNaoGeradoError';
  }
}
