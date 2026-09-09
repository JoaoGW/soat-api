export class VeiculoNaoEncontradoError extends Error {
  constructor() {
    super('Veiculo nao encontrado.');
    this.name = 'VeiculoNaoEncontradoError';
  }
}
