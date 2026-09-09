import { ClienteNaoEncontradoError } from '../../../domain/errors/ClienteNaoEncontradoError';
import { ClienteRepository } from '../../../domain/repositories/ClienteRepository';
import { Documento } from '../../../domain/value-objects/Documento';

export class BuscarClientePorDocumentoUseCase {
  constructor(private readonly clienteRepo: ClienteRepository) {}

  async execute(documentoRaw: string) {
    const documento = new Documento(documentoRaw);
    const cliente = await this.clienteRepo.findByDocumento(documento.valor);
    if (!cliente) throw new ClienteNaoEncontradoError();
    return cliente;
  }
}
