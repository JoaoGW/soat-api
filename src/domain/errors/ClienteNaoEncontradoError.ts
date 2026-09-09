export class ClienteNaoEncontradoError extends Error {
  constructor() {
    super('Cliente nao encontrado.');
    this.name = 'ClienteNaoEncontradoError';
  }
}
