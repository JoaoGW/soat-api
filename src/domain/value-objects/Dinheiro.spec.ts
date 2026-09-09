import { ValorMonetarioInvalidoError } from '../errors/ValorMonetarioInvalidoError';
import { Dinheiro } from './Dinheiro';

describe('Dinheiro', () => {
  it('deve rejeitar valor negativo', () => {
    expect(() => new Dinheiro(-1)).toThrow(ValorMonetarioInvalidoError);
  });

  it('deve somar valores corretamente', () => {
    const total = new Dinheiro(1500).somar(new Dinheiro(250));

    expect(total.centavos).toBe(1750);
  });

  it('deve multiplicar valores corretamente', () => {
    const total = new Dinheiro(101).multiplicar(1.5);

    expect(total.centavos).toBe(152);
  });

  it('deve retornar zero com factory estatica', () => {
    const zero = Dinheiro.zero();

    expect(zero.centavos).toBe(0);
  });
});
