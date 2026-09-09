import { Entity } from '../../shared/domain/Entity';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';
import { EstoqueInsuficienteError } from '../errors/EstoqueInsuficienteError';
import { Dinheiro } from '../value-objects/Dinheiro';
import { Quantidade } from '../value-objects/Quantidade';
import { QuantidadeEstoque } from '../value-objects/QuantidadeEstoque';

interface PecaProps {
  nome: string;
  preco: Dinheiro;
  quantidadeEstoque: QuantidadeEstoque;
  ativo: boolean;
  dataCriacao: Date;
  dataAtualizacao: Date;
}

export class Peca extends Entity<PecaProps> {
  constructor(props: PecaProps, id?: UniqueEntityId) {
    super(props, id);
  }

  get nome(): string {
    return this.props.nome;
  }

  get preco(): Dinheiro {
    return this.props.preco;
  }

  get quantidadeEstoque(): number {
    return this.props.quantidadeEstoque.valor;
  }

  get ativo(): boolean {
    return this.props.ativo;
  }

  get dataCriacao(): Date {
    return this.props.dataCriacao;
  }

  get dataAtualizacao(): Date {
    return this.props.dataAtualizacao;
  }

  possuiEstoqueSuficiente(quantidade: Quantidade): boolean {
    return this.props.quantidadeEstoque.valor >= quantidade.valor;
  }

  baixarEstoque(quantidade: Quantidade): void {
    if (!this.possuiEstoqueSuficiente(quantidade)) {
      throw new EstoqueInsuficienteError();
    }
    this.props.quantidadeEstoque = new QuantidadeEstoque(
      this.props.quantidadeEstoque.valor - quantidade.valor,
    );
    this.props.dataAtualizacao = new Date();
  }

  ajustarEstoque(novaQuantidade: QuantidadeEstoque): void {
    this.props.quantidadeEstoque = novaQuantidade;
    this.props.dataAtualizacao = new Date();
  }

  atualizarNome(nome: string): void {
    this.props.nome = nome;
    this.props.dataAtualizacao = new Date();
  }

  atualizarPreco(preco: Dinheiro): void {
    this.props.preco = preco;
    this.props.dataAtualizacao = new Date();
  }

  desativar(): void {
    this.props.ativo = false;
    this.props.dataAtualizacao = new Date();
  }

  static criar(nome: string, preco: Dinheiro, quantidadeEstoque: number): Peca {
    const agora = new Date();
    return new Peca({
      nome,
      preco,
      quantidadeEstoque: new QuantidadeEstoque(quantidadeEstoque),
      ativo: true,
      dataCriacao: agora,
      dataAtualizacao: agora,
    });
  }
}
