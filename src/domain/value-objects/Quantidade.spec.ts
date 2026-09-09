import { QuantidadeInvalidaError } from '../errors/QuantidadeInvalidaError';
import { Quantidade } from './Quantidade';

describe('Quantidade', () => {
  it('deve rejeitar zero', () => {
    expect(() => new Quantidade(0)).toThrow(QuantidadeInvalidaError);
  });

  it('deve rejeitar valor negativo', () => {
    expect(() => new Quantidade(-1)).toThrow(QuantidadeInvalidaError);
  });

  it('deve rejeitar valor decimal', () => {
    expect(() => new Quantidade(1.5)).toThrow(QuantidadeInvalidaError);
  });

  it('deve aceitar valor inteiro positivo', () => {
    const quantidade = new Quantidade(3);

    expect(quantidade.valor).toBe(3);
  });
});
