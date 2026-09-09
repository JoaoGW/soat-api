import { Entity } from '../../shared/domain/Entity';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';
import { PlacaVeiculo } from '../value-objects/PlacaVeiculo';

interface VeiculoProps {
  clienteId: string;
  placa: PlacaVeiculo;
  marca: string;
  modelo: string;
  ano: number;
  ativo: boolean;
  dataCriacao: Date;
  dataAtualizacao: Date;
}

export class Veiculo extends Entity<VeiculoProps> {
  constructor(props: VeiculoProps, id?: UniqueEntityId) {
    super(props, id);
  }

  get clienteId(): string {
    return this.props.clienteId;
  }

  get placa(): PlacaVeiculo {
    return this.props.placa;
  }

  get marca(): string {
    return this.props.marca;
  }

  get modelo(): string {
    return this.props.modelo;
  }

  get ano(): number {
    return this.props.ano;
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

  atualizarMarca(marca: string): void {
    this.props.marca = marca;
    this.props.dataAtualizacao = new Date();
  }

  atualizarModelo(modelo: string): void {
    this.props.modelo = modelo;
    this.props.dataAtualizacao = new Date();
  }

  atualizarAno(ano: number): void {
    this.props.ano = ano;
    this.props.dataAtualizacao = new Date();
  }

  desativar(): void {
    this.props.ativo = false;
    this.props.dataAtualizacao = new Date();
  }

  static criar(
    clienteId: string,
    placa: PlacaVeiculo,
    marca: string,
    modelo: string,
    ano: number,
  ): Veiculo {
    const agora = new Date();
    return new Veiculo({
      clienteId,
      placa,
      marca,
      modelo,
      ano,
      ativo: true,
      dataCriacao: agora,
      dataAtualizacao: agora,
    });
  }
}
