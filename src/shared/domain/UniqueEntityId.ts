import { randomUUID } from 'node:crypto';

export class UniqueEntityId {
  private readonly value: string;

  constructor(id?: string) {
    this.value = id ?? randomUUID();
  }

  toString(): string {
    return this.value;
  }

  equals(id: UniqueEntityId): boolean {
    return this.value === id.value;
  }
}
