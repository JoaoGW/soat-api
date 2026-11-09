import { EstadoSaga, FatoSaga, proximoEstado } from './EstadoSaga';

describe('transições da Saga', () => {
  it('exige pagamento antes da fila e conclui no fim do reparo', () => {
    const passos: [EstadoSaga, FatoSaga, EstadoSaga][] = [
      ['DIAGNOSTICO_PENDENTE', 'DIAGNOSTICO_CONCLUIDO', 'ORCAMENTO_PENDENTE'],
      ['ORCAMENTO_PENDENTE', 'ORCAMENTO_EMITIDO', 'AGUARDANDO_APROVACAO'],
      ['AGUARDANDO_APROVACAO', 'ORCAMENTO_APROVADO', 'RESERVA_PENDENTE'],
      ['RESERVA_PENDENTE', 'PECAS_RESERVADAS', 'COBRANCA_PENDENTE'],
      ['COBRANCA_PENDENTE', 'COBRANCA_CRIADA', 'AGUARDANDO_PAGAMENTO'],
      ['AGUARDANDO_PAGAMENTO', 'PAGAMENTO_CONFIRMADO', 'FILA_PENDENTE'],
      ['FILA_PENDENTE', 'TRABALHO_ENFILEIRADO', 'NA_FILA'],
      ['NA_FILA', 'TRABALHO_INICIADO', 'EM_EXECUCAO'],
      ['EM_EXECUCAO', 'TRABALHO_CONCLUIDO', 'CONCLUIDA'],
    ];
    for (const [estado, fato, esperado] of passos)
      expect(proximoEstado(estado, fato)).toBe(esperado);
    expect(
      proximoEstado('COBRANCA_PENDENTE', 'PAGAMENTO_CONFIRMADO'),
    ).toBeNull();
  });
  it('não reabre execução durante ou depois da compensação', () => {
    expect(proximoEstado('COMPENSANDO', 'TRABALHO_ENFILEIRADO')).toBeNull();
    expect(proximoEstado('COMPENSADA', 'PAGAMENTO_CONFIRMADO')).toBe(
      'RECONCILIACAO_NECESSARIA',
    );
    expect(proximoEstado('COMPENSANDO', 'COMPENSACOES_CONFIRMADAS')).toBe(
      'COMPENSADA',
    );
  });
  it('não presume reversão após início ou resultado financeiro incerto', () => {
    expect(proximoEstado('EM_EXECUCAO', 'FALHA_DEFINITIVA')).toBe(
      'RECONCILIACAO_NECESSARIA',
    );
    expect(proximoEstado('COBRANCA_PENDENTE', 'RESULTADO_INCERTO')).toBe(
      'RECONCILIACAO_NECESSARIA',
    );
    expect(proximoEstado('RESERVA_PENDENTE', 'FALHA_DEFINITIVA')).toBe(
      'COMPENSANDO',
    );
  });
});
