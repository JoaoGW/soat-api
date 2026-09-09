import { UniqueEntityId } from './UniqueEntityId';

describe('UniqueEntityId', () => {
  it('deve manter o valor informado', () => {
    const id = new UniqueEntityId('id-fixo');

    expect(id.toString()).toBe('id-fixo');
  });

  it('deve comparar igualdade por valor', () => {
    const idA = new UniqueEntityId('mesmo-id');
    const idB = new UniqueEntityId('mesmo-id');
    const idC = new UniqueEntityId('outro-id');

    expect(idA.equals(idB)).toBe(true);
    expect(idA.equals(idC)).toBe(false);
  });
});
