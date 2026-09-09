import { UniqueEntityId } from './UniqueEntityId';

export abstract class Entity<T> {
  protected readonly id: UniqueEntityId;
  protected props: T;

  constructor(props: T, id?: UniqueEntityId) {
    this.id = id ?? new UniqueEntityId();
    this.props = props;
  }

  equals(entity: Entity<T>): boolean {
    return this.id.equals(entity.id);
  }

  getId(): string {
    return this.id.toString();
  }
}
