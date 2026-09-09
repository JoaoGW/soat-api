export class ServicoNaoEncontradoError extends Error {
  constructor() {
    super('Servico nao encontrado.');
    this.name = 'ServicoNaoEncontradoError';
  }
}
