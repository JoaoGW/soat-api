import { OrdemDeServico } from '../../domain/entities/OrdemDeServico';
import { StatusOS } from '../../domain/enums/StatusOS';
import { CodigoAcompanhamento } from '../../domain/value-objects/CodigoAcompanhamento';
import { Dinheiro } from '../../domain/value-objects/Dinheiro';
import { ItemOS } from '../../domain/value-objects/ItemOS';
import { ItemServicoOS } from '../../domain/value-objects/ItemServicoOS';
import { Quantidade } from '../../domain/value-objects/Quantidade';
import { UniqueEntityId } from '../../shared/domain/UniqueEntityId';

export class OrdemDeServicoMapper {
  static toDomain(ordemData: any): OrdemDeServico {
    const itens = (ordemData.itens ?? []).map(
      (pecaData: any) =>
        new ItemOS(
          pecaData.pecaId,
          new Quantidade(pecaData.quantidade),
          new Dinheiro(pecaData.precoUnitario),
        ),
    );

    const servicos = (ordemData.servicos ?? []).map(
      (servicoData: any) =>
        new ItemServicoOS(
          servicoData.servicoId,
          new Dinheiro(servicoData.precoUnitario ?? servicoData.preco ?? 0),
        ),
    );

    const status = Object.values(StatusOS).includes(ordemData.status)
      ? (ordemData.status as StatusOS)
      : StatusOS.RECEBIDA;

    return new OrdemDeServico(
      {
        clienteId: ordemData.clienteId,
        veiculoId: ordemData.veiculoId,
        codigoAcompanhamento: ordemData.codigoAcompanhamento
          ? CodigoAcompanhamento.criar(ordemData.codigoAcompanhamento)
          : CodigoAcompanhamento.gerar(),
        status,
        servicos,
        itens,
        valorTotal: new Dinheiro(ordemData.valorTotal ?? 0),
        orcamentoGerado: ordemData.orcamentoGerado ?? false,
        orcamentoAprovado: ordemData.orcamentoAprovado ?? false,
        dataInicioExecucao: ordemData.dataInicioExecucao
          ? new Date(ordemData.dataInicioExecucao)
          : undefined,
        dataFinalizacao: ordemData.dataFinalizacao
          ? new Date(ordemData.dataFinalizacao)
          : undefined,
        dataCriacao: ordemData.createdAt
          ? new Date(ordemData.createdAt)
          : new Date(),
        dataAtualizacao: ordemData.updatedAt
          ? new Date(ordemData.updatedAt)
          : new Date(),
      },
      new UniqueEntityId(ordemData.id),
    );
  }
}
