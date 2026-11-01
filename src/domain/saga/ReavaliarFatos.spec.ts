import { reavaliarFatos } from './ReavaliarFatos';

describe('reavaliação de fatos da Saga', () => {
  it('conserva pagamento antecipado e o aplica após criação da cobrança', () => {
    const payment = { messageId: 'p', fato: 'PAGAMENTO_CONFIRMADO' } as const;
    const first = reavaliarFatos('COBRANCA_PENDENTE', [payment]);
    expect(first).toEqual({
      estado: 'COBRANCA_PENDENTE',
      aplicados: [],
      pendentes: [payment],
    });
    const charge = { messageId: 'c', fato: 'COBRANCA_CRIADA' } as const;
    const second = reavaliarFatos(first.estado, [...first.pendentes, charge]);
    expect(second.estado).toBe('FILA_PENDENTE');
    expect(second.aplicados.map((fact) => fact.messageId)).toEqual(['c', 'p']);
    expect(second.pendentes).toEqual([]);
  });
  it('não inicia execução com fatos ausentes', () => {
    const result = reavaliarFatos('AGUARDANDO_PAGAMENTO', [
      { messageId: 'q', fato: 'TRABALHO_ENFILEIRADO' },
    ]);
    expect(result.estado).toBe('AGUARDANDO_PAGAMENTO');
    expect(result.pendentes).toHaveLength(1);
  });
  it('sinaliza reconciliação para pagamento tardio durante compensação', () => {
    const result = reavaliarFatos('COMPENSANDO', [
      { messageId: 'p', fato: 'PAGAMENTO_CONFIRMADO' },
      { messageId: 'c', fato: 'COMPENSACOES_CONFIRMADAS' },
    ]);
    expect(result.estado).toBe('RECONCILIACAO_NECESSARIA');
    expect(result.pendentes.map((fact) => fact.messageId)).toEqual(['c']);
  });
  it('rejeita IDs vazios ou duplicados sem alterar entrada', () => {
    const input = [
      { messageId: 'x', fato: 'COBRANCA_CRIADA' } as const,
      { messageId: 'x', fato: 'PAGAMENTO_CONFIRMADO' } as const,
    ];
    expect(() => reavaliarFatos('COBRANCA_PENDENTE', input)).toThrow(
      'repetida',
    );
    expect(input).toHaveLength(2);
    expect(() =>
      reavaliarFatos('COBRANCA_PENDENTE', [
        { messageId: '', fato: 'COBRANCA_CRIADA' },
      ]),
    ).toThrow('vazia');
  });
});
