export class OrdemDeServicoNaoEncontradaError extends Error {
  constructor() {
    super('Ordem de servico nao encontrada.');
    this.name = 'OrdemDeServicoNaoEncontradaError';
  }
}
