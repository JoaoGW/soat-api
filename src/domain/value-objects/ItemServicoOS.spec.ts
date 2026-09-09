import { Dinheiro } from './Dinheiro';
import { ItemServicoOS } from './ItemServicoOS';

describe('ItemServicoOS', () => {
  it('deve criar item de servico valido com snapshot de preco', () => {
    const preco = new Dinheiro(19990);
    const item = new ItemServicoOS('servico-1', preco);

    expect(item.servicoId).toBe('servico-1');
    expect(item.preco.centavos).toBe(19990);
  });

  it('deve manter preco preservado no item', () => {
    const preco = new Dinheiro(25000);
    const item = new ItemServicoOS('servico-2', preco);
    const novoPrecoCadastro = new Dinheiro(50000);

    expect(item.preco.centavos).toBe(25000);
    expect(novoPrecoCadastro.centavos).toBe(50000);
  });
});
