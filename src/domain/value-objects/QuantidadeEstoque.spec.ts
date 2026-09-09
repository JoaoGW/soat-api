import { QuantidadeEstoqueInvalidaError } from '../errors/QuantidadeEstoqueInvalidaError';
import { QuantidadeEstoque } from './QuantidadeEstoque';

describe('QuantidadeEstoque', () => {
  it('deve aceitar valor positivo', () => {
    const quantidade = new QuantidadeEstoque(10);
    expect(quantidade.valor).toBe(10);
  });

  it('deve aceitar zero', () => {
    const quantidade = new QuantidadeEstoque(0);
    expect(quantidade.valor).toBe(0);
  });

  it('deve rejeitar valor negativo', () => {
    expect(() => new QuantidadeEstoque(-1)).toThrow(
      QuantidadeEstoqueInvalidaError,
    );
  });
});
