import { CodigoAcompanhamentoInvalidoError } from '../errors/CodigoAcompanhamentoInvalidoError';
import { CodigoAcompanhamento } from './CodigoAcompanhamento';

describe('CodigoAcompanhamento', () => {
  it('deve gerar codigo valido', () => {
    const codigo = CodigoAcompanhamento.gerar();
    expect(codigo.valor).toMatch(/^OS-\d{4}-[A-Z0-9]{6}$/);
  });

  it('deve criar codigo valido explicitamente', () => {
    const codigo = CodigoAcompanhamento.criar('OS-2026-A8K92P');
    expect(codigo.valor).toBe('OS-2026-A8K92P');
  });

  it('deve rejeitar codigo invalido', () => {
    expect(() => CodigoAcompanhamento.criar('abc')).toThrow(
      CodigoAcompanhamentoInvalidoError,
    );
  });
});
