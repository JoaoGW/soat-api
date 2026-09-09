export class QuantidadeEstoqueInvalidaError extends Error {
  constructor(valor?: number) {
    super(
      valor === undefined
        ? 'Quantidade de estoque invalida.'
        : `Quantidade de estoque invalida: ${valor}.`,
    );
    this.name = 'QuantidadeEstoqueInvalidaError';
  }
}
