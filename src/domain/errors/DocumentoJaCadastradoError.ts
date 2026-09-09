export class DocumentoJaCadastradoError extends Error {
  constructor() {
    super('Documento ja cadastrado.');
    this.name = 'DocumentoJaCadastradoError';
  }
}
