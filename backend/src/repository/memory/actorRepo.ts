import { Actor } from '../../domain/types';
import { IActorRepo } from '../interfaces';

export class InMemoryActorRepo implements IActorRepo {
  private readonly actors = new Map<string, Actor>();

  async create(actor: Actor): Promise<Actor> {
    this.actors.set(actor.id, actor);
    return actor;
  }

  async findById(id: string): Promise<Actor | null> {
    return this.actors.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<Actor | null> {
    for (const actor of this.actors.values()) {
      if (actor.email.toLowerCase() === email.toLowerCase()) return actor;
    }
    return null;
  }
}
