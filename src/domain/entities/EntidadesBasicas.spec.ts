import { Cliente } from './Cliente';
import { Veiculo } from './Veiculo';
import { Servico } from './Servico';
import { Peca } from './Peca';
import { Documento } from '../value-objects/Documento';
import { PlacaVeiculo } from '../value-objects/PlacaVeiculo';
import { Dinheiro } from '../value-objects/Dinheiro';

function metodosDeInstancia(ctor: { prototype: object }): string[] {
  const descriptors = Object.getOwnPropertyDescriptors(ctor.prototype);
  return Object.entries(descriptors)
    .filter(
      ([nome, descriptor]) =>
        nome !== 'constructor' && typeof descriptor.value === 'function',
    )
    .map(([nome]) => nome);
}

describe('Entidades basicas do dominio', () => {
  it('deve criar Cliente via factory com Documento VO', () => {
    const documento = new Documento('52998224725');
    const cliente = Cliente.criar(
      'Ana Souza',
      documento,
      'PF',
      'ana@email.com',
    );

    expect(cliente.nome).toBe('Ana Souza');
    expect(cliente.documento).toBe(documento);
    expect(cliente.tipo).toBe('PF');
    expect(cliente.contato).toBe('ana@email.com');
    expect(cliente.ativo).toBe(true);
    expect(cliente.dataCriacao).toBeInstanceOf(Date);
    expect(cliente.dataAtualizacao).toBeInstanceOf(Date);
  });

  it('deve criar Veiculo via factory com PlacaVeiculo VO', () => {
    const placa = new PlacaVeiculo('ABC1D23');
    const veiculo = Veiculo.criar(
      'cliente-1',
      placa,
      'Volkswagen',
      'Gol',
      2020,
    );

    expect(veiculo.clienteId).toBe('cliente-1');
    expect(veiculo.placa).toBe(placa);
    expect(veiculo.marca).toBe('Volkswagen');
    expect(veiculo.modelo).toBe('Gol');
    expect(veiculo.ano).toBe(2020);
    expect(veiculo.ativo).toBe(true);
    expect(veiculo.dataCriacao).toBeInstanceOf(Date);
    expect(veiculo.dataAtualizacao).toBeInstanceOf(Date);
  });

  it('deve criar Servico via factory com Dinheiro VO', () => {
    const preco = new Dinheiro(15000);
    const servico = Servico.criar(
      'Alinhamento',
      'Alinhamento computadorizado',
      preco,
    );

    expect(servico.nome).toBe('Alinhamento');
    expect(servico.descricao).toBe('Alinhamento computadorizado');
    expect(servico.preco).toBe(preco);
    expect(servico.ativo).toBe(true);
    expect(servico.dataCriacao).toBeInstanceOf(Date);
    expect(servico.dataAtualizacao).toBeInstanceOf(Date);
  });

  it('deve criar Peca via factory com Dinheiro VO', () => {
    const preco = new Dinheiro(8999);
    const peca = Peca.criar('Filtro de oleo', preco, 12);

    expect(peca.nome).toBe('Filtro de oleo');
    expect(peca.preco).toBe(preco);
    expect(peca.quantidadeEstoque).toBe(12);
    expect(peca.ativo).toBe(true);
    expect(peca.dataCriacao).toBeInstanceOf(Date);
    expect(peca.dataAtualizacao).toBeInstanceOf(Date);
  });

  it('nao deve expor metodos de processamento/transicao nas entidades basicas', () => {
    expect(metodosDeInstancia(Cliente)).toEqual([
      'atualizarNome',
      'atualizarContato',
      'desativar',
    ]);
    expect(metodosDeInstancia(Veiculo)).toEqual([
      'atualizarMarca',
      'atualizarModelo',
      'atualizarAno',
      'desativar',
    ]);
    expect(metodosDeInstancia(Servico)).toEqual([
      'atualizarNome',
      'atualizarDescricao',
      'atualizarPreco',
      'desativar',
    ]);
    expect(metodosDeInstancia(Peca)).toEqual([
      'possuiEstoqueSuficiente',
      'baixarEstoque',
      'ajustarEstoque',
      'atualizarNome',
      'atualizarPreco',
      'desativar',
    ]);
  });
});
