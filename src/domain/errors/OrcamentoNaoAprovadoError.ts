export class OrcamentoNaoAprovadoError extends Error {
  constructor() {
    super('Orcamento ainda nao foi aprovado.');
    this.name = 'OrcamentoNaoAprovadoError';
  }
}
