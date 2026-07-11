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

  async findAllByTenant(tenantId: string): Promise<Actor[]> {
    return [...this.actors.values()]
      .filter((a) => a.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async update(actor: Actor): Promise<Actor> {
    this.actors.set(actor.id, actor);
    return actor;
  }

  /** Snapshot-only: dumps every record for persistence, ignoring tenant scoping. */
  _dump(): Actor[] {
    return [...this.actors.values()];
  }

  /** Snapshot-only: replaces all in-memory data with the given rows. */
  _load(rows: Actor[]): void {
    this.actors.clear();
    for (const row of rows) this.actors.set(row.id, row);
  }
}
