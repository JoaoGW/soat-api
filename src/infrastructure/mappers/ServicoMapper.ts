import { Servico } from '../../domain/entities/Servico';
import { Dinheiro } from '../../domain/value-objects/Dinheiro';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';

export class ServicoMapper {
  static toDomain(servicoData: any): Servico {
    return new Servico(
      {
        nome: servicoData.nome,
        descricao: servicoData.descricao,
        preco: new Dinheiro(servicoData.preco),
        ativo: servicoData.ativo ?? true,
        dataCriacao: servicoData.createdAt
          ? new Date(servicoData.createdAt)
          : new Date(),
        dataAtualizacao: servicoData.updatedAt
          ? new Date(servicoData.updatedAt)
          : new Date(),
      },
      new UniqueEntityId(servicoData.id),
    );
  }
}
