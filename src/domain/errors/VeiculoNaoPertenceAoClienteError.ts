export class VeiculoNaoPertenceAoClienteError extends Error {
  constructor() {
    super('Veiculo nao pertence ao cliente informado.');
    this.name = 'VeiculoNaoPertenceAoClienteError';
  }
}
