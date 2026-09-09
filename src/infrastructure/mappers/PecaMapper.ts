import { Peca } from '../../domain/entities/Peca';
import { Dinheiro } from '../../domain/value-objects/Dinheiro';
import { QuantidadeEstoque } from '../../domain/value-objects/QuantidadeEstoque';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';

export class PecaMapper {
  static toDomain(pecaData: any): Peca {
    return new Peca(
      {
        nome: pecaData.nome,
        preco: new Dinheiro(pecaData.preco),
        quantidadeEstoque: new QuantidadeEstoque(pecaData.quantidadeEstoque),
        ativo: pecaData.ativo ?? true,
        dataCriacao: pecaData.createdAt
          ? new Date(pecaData.createdAt)
          : new Date(),
        dataAtualizacao: pecaData.updatedAt
          ? new Date(pecaData.updatedAt)
          : new Date(),
      },
      new UniqueEntityId(pecaData.id),
    );
  }
}
