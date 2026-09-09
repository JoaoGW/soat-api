import { Cliente } from '../../../domain/entities/Cliente';
import { DocumentoJaCadastradoError } from '../../../domain/errors/DocumentoJaCadastradoError';
import { ClienteRepository } from '../../../domain/repositories/ClienteRepository';
import { Documento } from '../../../domain/value-objects/Documento';

interface Input {
  nome: string;
  documento: string;
  contato: string;
}

interface Output {
  id: string;
}

export class CriarClienteUseCase {
  constructor(private readonly clienteRepo: ClienteRepository) {}

  async execute(input: Input): Promise<Output> {
    const documento = new Documento(input.documento);
    const existente = await this.clienteRepo.findByDocumento(documento.valor);
    if (existente) throw new DocumentoJaCadastradoError();

    const cliente = Cliente.criar({
      nome: input.nome,
      documento,
      contato: input.contato,
    });

    await this.clienteRepo.save(cliente);
    return { id: cliente.getId() };
  }
}
