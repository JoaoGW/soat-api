export class PlacaJaCadastradaError extends Error {
  constructor() {
    super('Placa ja cadastrada.');
    this.name = 'PlacaJaCadastradaError';
  }
}
