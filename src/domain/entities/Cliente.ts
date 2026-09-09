import { Entity } from '../../shared/domain/Entity';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';
import { Documento } from '../value-objects/Documento';

interface ClienteProps {
  nome: string;
  documento: Documento;
  tipo: 'PF' | 'PJ';
  contato: string;
  ativo: boolean;
  dataCriacao: Date;
  dataAtualizacao: Date;
}

export class Cliente extends Entity<ClienteProps> {
  constructor(props: ClienteProps, id?: UniqueEntityId) {
    super(props, id);
  }

  get nome(): string {
    return this.props.nome;
  }

  get documento(): Documento {
    return this.props.documento;
  }

  get tipo(): 'PF' | 'PJ' {
    return this.props.tipo;
  }
  get contato(): string {
    return this.props.contato;
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

  atualizarContato(contato: string): void {
    this.props.contato = contato;
    this.props.dataAtualizacao = new Date();
  }

  desativar(): void {
    this.props.ativo = false;
    this.props.dataAtualizacao = new Date();
  }

  static criar(
    nome: string,
    documento: Documento,
    tipo: 'PF' | 'PJ',
    contato?: string,
  ): Cliente;
  static criar(input: {
    nome: string;
    documento: Documento;
    contato: string;
  }): Cliente;
  static criar(
    inputOuNome:
      | string
      | {
          nome: string;
          documento: Documento;
          contato: string;
        },
    documentoArg?: Documento,
    tipoArg?: 'PF' | 'PJ',
    contatoArg?: string,
  ): Cliente {
    const nome =
      typeof inputOuNome === 'string' ? inputOuNome : inputOuNome.nome;
    const documento =
      typeof inputOuNome === 'string' ? documentoArg : inputOuNome.documento;
    const contato =
      typeof inputOuNome === 'string'
        ? (contatoArg ?? '')
        : inputOuNome.contato;
    const tipo = documento.tipo === 'CPF' ? 'PF' : 'PJ';

    const agora = new Date();
    return new Cliente({
      nome,
      documento,
      tipo,
      contato,
      ativo: true,
      dataCriacao: agora,
      dataAtualizacao: agora,
    });
  }
}
