import { StatusOS } from '../../domain/enums/StatusOS';
import { OrdemDeServicoMapper } from './OrdemDeServicoMapper';

describe('OrdemDeServicoMapper', () => {
  it('deve reconstruir agregado com itens, servicos e datas opcionais', () => {
    const ordemData = {
      id: 'os-1',
      codigoAcompanhamento: 'OS-2026-A8K92P',
      clienteId: 'cliente-1',
      veiculoId: 'veiculo-1',
      status: StatusOS.EM_EXECUCAO,
      valorTotal: 23000,
      orcamentoGerado: true,
      orcamentoAprovado: true,
      dataInicioExecucao: new Date('2026-01-01T10:00:00.000Z'),
      dataFinalizacao: null,
      createdAt: new Date('2026-01-01T08:00:00.000Z'),
      updatedAt: new Date('2026-01-01T11:00:00.000Z'),
      itens: [{ pecaId: 'peca-1', quantidade: 2, precoUnitario: 4000 }],
      servicos: [{ servicoId: 'servico-1', precoUnitario: 15000 }],
    };

    const os = OrdemDeServicoMapper.toDomain(ordemData);

    expect(os.getId()).toBe('os-1');
    expect(os.codigoAcompanhamento.valor).toBe('OS-2026-A8K92P');
    expect(os.status).toBe(StatusOS.EM_EXECUCAO);
    expect(os.valorTotal.centavos).toBe(23000);
    expect(os.itens).toHaveLength(1);
    expect(os.itens[0].pecaId).toBe('peca-1');
    expect(os.itens[0].quantidade.valor).toBe(2);
    expect(os.itens[0].precoUnitario.centavos).toBe(4000);
    expect(os.servicos).toHaveLength(1);
    expect(os.servicos[0].servicoId).toBe('servico-1');
    expect(os.servicos[0].preco.centavos).toBe(15000);
    expect(os.dataInicioExecucao).toEqual(new Date('2026-01-01T10:00:00.000Z'));
    expect(os.dataFinalizacao).toBeUndefined();
  });

  it('deve usar RECEBIDA para status invalido', () => {
    const ordemData = {
      id: 'os-2',
      codigoAcompanhamento: 'OS-2026-Z9Y8X7',
      clienteId: 'cliente-2',
      veiculoId: 'veiculo-2',
      status: 'STATUS_INVALIDO',
      valorTotal: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const os = OrdemDeServicoMapper.toDomain(ordemData);
    expect(os.status).toBe(StatusOS.RECEBIDA);
  });

  it('deve reconstruir OS cancelada', () => {
    const ordemData = {
      id: 'os-3',
      codigoAcompanhamento: 'OS-2026-C4NCLD',
      clienteId: 'cliente-3',
      veiculoId: 'veiculo-3',
      status: StatusOS.CANCELADA,
      valorTotal: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const os = OrdemDeServicoMapper.toDomain(ordemData);
    expect(os.status).toBe(StatusOS.CANCELADA);
  });
});
