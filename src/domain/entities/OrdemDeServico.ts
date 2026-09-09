import { Entity } from '../../shared/domain/Entity';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';
import { StatusOS, transicoesValidas } from '../enums/StatusOS';
import { ItemOS } from '../value-objects/ItemOS';
import { ItemServicoOS } from '../value-objects/ItemServicoOS';
import { Dinheiro } from '../value-objects/Dinheiro';
import { Quantidade } from '../value-objects/Quantidade';
import { TransicaoStatusInvalidaError } from '../errors/TransicaoStatusInvalidaError';
import { OrcamentoNaoPodeSerGeradoError } from '../errors/OrcamentoNaoPodeSerGeradoError';
import { ExecucaoNaoPodeSerIniciadaError } from '../errors/ExecucaoNaoPodeSerIniciadaError';
import { OrdemDeServicoSemServicoError } from '../errors/OrdemDeServicoSemServicoError';
import { OrcamentoNaoAprovadoError } from '../errors/OrcamentoNaoAprovadoError';
import { OrcamentoNaoGeradoError } from '../errors/OrcamentoNaoGeradoError';
import { CodigoAcompanhamento } from '../value-objects/CodigoAcompanhamento';

interface OrdemDeServicoProps {
  clienteId: string;
  veiculoId: string;
  codigoAcompanhamento: CodigoAcompanhamento;
  status: StatusOS;
  servicos: ItemServicoOS[];
  itens: ItemOS[];
  valorTotal: Dinheiro;
  orcamentoGerado: boolean;
  orcamentoAprovado: boolean;
  dataInicioExecucao?: Date;
  dataFinalizacao?: Date;
  dataCriacao: Date;
  dataAtualizacao: Date;
}

export class OrdemDeServico extends Entity<OrdemDeServicoProps> {
  constructor(props: OrdemDeServicoProps, id?: UniqueEntityId) {
    super(props, id);
  }

  get status(): StatusOS {
    return this.props.status;
  }
  get clienteId(): string {
    return this.props.clienteId;
  }
  get veiculoId(): string {
    return this.props.veiculoId;
  }
  get codigoAcompanhamento(): CodigoAcompanhamento {
    return this.props.codigoAcompanhamento;
  }
  get valorTotal(): Dinheiro {
    return this.props.valorTotal;
  }
  get dataCriacao(): Date {
    return this.props.dataCriacao;
  }
  get itens(): ItemOS[] {
    return [...this.props.itens];
  }
  get servicos(): ItemServicoOS[] {
    return [...this.props.servicos];
  }
  get servicoIds(): string[] {
    return this.props.servicos.map((servico) => servico.servicoId);
  }
  get dataInicioExecucao(): Date | undefined {
    return this.props.dataInicioExecucao;
  }
  get dataFinalizacao(): Date | undefined {
    return this.props.dataFinalizacao;
  }
  get dataAtualizacao(): Date {
    return this.props.dataAtualizacao;
  }
  get orcamentoGerado(): boolean {
    return this.props.orcamentoGerado;
  }
  get orcamentoAprovado(): boolean {
    return this.props.orcamentoAprovado;
  }

  private transicionar(para: StatusOS): void {
    const permitidos = transicoesValidas[this.props.status];
    if (!permitidos.includes(para)) {
      throw new TransicaoStatusInvalidaError(this.props.status, para);
    }
    this.props.status = para;
    this.props.dataAtualizacao = new Date();
  }

  iniciarDiagnostico(): void {
    this.transicionar(StatusOS.EM_DIAGNOSTICO);
  }

  adicionarServico(servicoId: string): void;
  adicionarServico(servicoId: string, preco: Dinheiro): void;
  adicionarServico(servicoId: string, preco?: Dinheiro): void {
    this.props.servicos.push(
      new ItemServicoOS(servicoId, preco ?? Dinheiro.zero()),
    );
    this.props.orcamentoGerado = false;
    this.props.orcamentoAprovado = false;
    this.props.dataAtualizacao = new Date();
  }

  adicionarPeca(
    pecaId: string,
    quantidade: Quantidade,
    precoUnitario: Dinheiro,
  ): void {
    const peca = new ItemOS(pecaId, quantidade, precoUnitario);
    this.props.itens.push(peca);
    this.props.orcamentoGerado = false;
    this.props.orcamentoAprovado = false;
    this.props.dataAtualizacao = new Date();
  }

  gerarOrcamento(): void;
  gerarOrcamento(precosServicos: Dinheiro[]): void;
  gerarOrcamento(precosServicos?: Dinheiro[]): void {
    this.validarOrcamentoPodeSerGerado();
    this.props.valorTotal = this.calcularValorTotal(precosServicos);
    this.props.orcamentoGerado = true;
    this.props.orcamentoAprovado = false;
    this.props.dataAtualizacao = new Date();
  }

  private validarOrcamentoPodeSerGerado(): void {
    if (this.props.status !== StatusOS.EM_DIAGNOSTICO) {
      throw new OrcamentoNaoPodeSerGeradoError();
    }
    if (this.props.servicos.length === 0) {
      throw new OrdemDeServicoSemServicoError();
    }
  }

  private calcularValorTotal(precosServicos?: Dinheiro[]): Dinheiro {
    const precos =
      precosServicos ?? this.props.servicos.map((servico) => servico.preco);
    const totalServicos = precos.reduce(
      (total, preco) => total.somar(preco),
      Dinheiro.zero(),
    );
    const totalPecas = this.props.itens.reduce(
      (total, peca) => total.somar(peca.subtotal),
      Dinheiro.zero(),
    );
    return totalServicos.somar(totalPecas);
  }

  enviarOrcamentoParaAprovacao(): void {
    if (!this.props.orcamentoGerado) {
      throw new OrcamentoNaoGeradoError();
    }
    this.transicionar(StatusOS.AGUARDANDO_APROVACAO);
  }

  aprovarOrcamento(): void {
    if (this.props.status !== StatusOS.AGUARDANDO_APROVACAO) {
      throw new TransicaoStatusInvalidaError(
        this.props.status,
        StatusOS.AGUARDANDO_APROVACAO,
      );
    }
    this.props.orcamentoAprovado = true;
    this.props.dataAtualizacao = new Date();
  }

  recusarOrcamento(): void {
    this.transicionar(StatusOS.CANCELADA);
  }

  iniciarExecucao(): void {
    if (this.props.status !== StatusOS.AGUARDANDO_APROVACAO) {
      throw new ExecucaoNaoPodeSerIniciadaError();
    }
    if (!this.props.orcamentoAprovado) {
      throw new OrcamentoNaoAprovadoError();
    }
    this.transicionar(StatusOS.EM_EXECUCAO);
    this.props.dataInicioExecucao = new Date();
  }

  finalizarServico(): void {
    this.transicionar(StatusOS.FINALIZADA);
    this.props.dataFinalizacao = new Date();
  }

  entregarVeiculo(): void {
    this.transicionar(StatusOS.ENTREGUE);
  }

  static criar(
    clienteId: string,
    veiculoId: string,
    codigoAcompanhamento?: CodigoAcompanhamento,
  ): OrdemDeServico {
    return new OrdemDeServico({
      clienteId,
      veiculoId,
      codigoAcompanhamento:
        codigoAcompanhamento ?? CodigoAcompanhamento.gerar(),
      status: StatusOS.RECEBIDA,
      servicos: [],
      itens: [],
      valorTotal: Dinheiro.zero(),
      orcamentoGerado: false,
      orcamentoAprovado: false,
      dataCriacao: new Date(),
      dataAtualizacao: new Date(),
    });
  }
}
