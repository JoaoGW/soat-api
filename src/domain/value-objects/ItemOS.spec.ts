import { Dinheiro } from './Dinheiro';
import { ItemOS } from './ItemOS';
import { Quantidade } from './Quantidade';

describe('ItemOS', () => {
  it('deve expor getters corretamente', () => {
    const quantidade = new Quantidade(2);
    const precoUnitario = new Dinheiro(5000);
    const item = new ItemOS('peca-1', quantidade, precoUnitario);

    expect(item.pecaId).toBe('peca-1');
    expect(item.quantidade).toBe(quantidade);
    expect(item.precoUnitario).toBe(precoUnitario);
  });

  it('deve calcular subtotal corretamente', () => {
    const item = new ItemOS('peca-1', new Quantidade(3), new Dinheiro(8999));

    expect(item.subtotal.centavos).toBe(26997);
  });
});
