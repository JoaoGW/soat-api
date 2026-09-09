import { Cliente } from '../../domain/entities/Cliente';
import { Documento } from '../../domain/value-objects/Documento';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';

export class ClienteMapper {
  static toDomain(clienteData: any): Cliente {
    return new Cliente(
      {
        nome: clienteData.nome,
        documento: new Documento(clienteData.documento),
        tipo:
          clienteData.tipo ??
          (clienteData.documento?.length === 11 ? 'PF' : 'PJ'),
        contato: clienteData.contato ?? '',
        ativo: clienteData.ativo ?? true,
        dataCriacao: clienteData.createdAt
          ? new Date(clienteData.createdAt)
          : new Date(),
        dataAtualizacao: clienteData.updatedAt
          ? new Date(clienteData.updatedAt)
          : new Date(),
      },
      new UniqueEntityId(clienteData.id),
    );
  }
}
