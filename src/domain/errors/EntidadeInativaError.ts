export class EntidadeInativaError extends Error {
  constructor() {
    super('Entidade inativa.');
    this.name = 'EntidadeInativaError';
  }
}
