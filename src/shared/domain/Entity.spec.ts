import { Entity } from './Entity';
import { UniqueEntityId } from './UniqueEntityId';

interface TestEntityProps {
  nome: string;
}

class TestEntity extends Entity<TestEntityProps> {
  get nome(): string {
    return this.props.nome;
  }
}

describe('Entity', () => {
  it('deve considerar entidades iguais quando compartilham o mesmo id', () => {
    const idValor = 'entidade-1';
    const entidadeA = new TestEntity(
      { nome: 'A' },
      new UniqueEntityId(idValor),
    );
    const entidadeB = new TestEntity(
      { nome: 'B' },
      new UniqueEntityId(idValor),
    );

    expect(entidadeA.equals(entidadeB)).toBe(true);
  });

  it('deve retornar false quando ids sao diferentes', () => {
    const entidadeA = new TestEntity({ nome: 'A' }, new UniqueEntityId('id-1'));
    const entidadeB = new TestEntity({ nome: 'B' }, new UniqueEntityId('id-2'));

    expect(entidadeA.equals(entidadeB)).toBe(false);
  });

  it('deve expor o id como string', () => {
    const entidade = new TestEntity(
      { nome: 'Teste' },
      new UniqueEntityId('id-legivel'),
    );

    expect(entidade.getId()).toBe('id-legivel');
  });
});
