export class EstoqueInsuficienteError extends Error {
  constructor() {
    super('Estoque insuficiente para a operacao.');
    this.name = 'EstoqueInsuficienteError';
  }
}
