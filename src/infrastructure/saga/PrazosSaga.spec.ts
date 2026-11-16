import {
  SAGA_DEADLINE_DEFAULTS,
  sagaDeadlineAt,
  sagaDeadlineMinutes,
} from './PrazosSaga';

describe('prazos configuráveis da Saga', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  it.each(Object.entries(SAGA_DEADLINE_DEFAULTS))(
    '%s usa o padrão sem configuração',
    (name, minutes) => {
      expect(sagaDeadlineMinutes(name as never, {})).toBe(minutes);
    },
  );
  it('aceita minutos inteiros positivos e ignora valores inválidos', () => {
    const name = 'SAGA_EXECUTION_DEADLINE_MINUTES';
    expect(sagaDeadlineMinutes(name, { [name]: '90' })).toBe(90);
    for (const value of ['', '0', '-1', '2.5', '1e3', 'x', '600000'])
      expect(sagaDeadlineMinutes(name, { [name]: value })).toBe(2880);
  });
  it('calcula o instante do prazo a partir de agora', () => {
    expect(
      sagaDeadlineAt('SAGA_QUEUE_DEADLINE_MINUTES', now, {
        SAGA_QUEUE_DEADLINE_MINUTES: '15',
      }),
    ).toEqual(new Date('2030-01-01T00:15:00Z'));
  });
});
