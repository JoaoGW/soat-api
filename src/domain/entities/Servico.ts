import { Entity } from '../../shared/domain/Entity';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';
import { Dinheiro } from '../value-objects/Dinheiro';

interface ServicoProps {
  nome: string;
  descricao: string;
  preco: Dinheiro;
  ativo: boolean;
  dataCriacao: Date;
  dataAtualizacao: Date;
}

export class Servico extends Entity<ServicoProps> {
  constructor(props: ServicoProps, id?: UniqueEntityId) {
    super(props, id);
  }

  get nome(): string {
    return this.props.nome;
  }

  get descricao(): string {
    return this.props.descricao;
  }

  get preco(): Dinheiro {
    return this.props.preco;
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

  atualizarNome(nome: string): void {
    this.props.nome = nome;
    this.props.dataAtualizacao = new Date();
  }

  atualizarDescricao(descricao: string): void {
    this.props.descricao = descricao;
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

  static criar(nome: string, descricao: string, preco: Dinheiro): Servico {
    const agora = new Date();
    return new Servico({
      nome,
      descricao,
      preco,
      ativo: true,
      dataCriacao: agora,
      dataAtualizacao: agora,
    });
  }
}
