import { Actor } from '../../domain/types';
import { IActorRepo } from '../interfaces';

// TODO: implement using `pg` Pool — see migrations/001_init.sql for schema.
export class PostgresActorRepo implements IActorRepo {
  async create(_actor: Actor): Promise<Actor> {
    throw new Error('PostgresActorRepo not implemented yet');
  }
  async findById(_id: string): Promise<Actor | null> {
    throw new Error('PostgresActorRepo not implemented yet');
  }
  async findByEmail(_email: string): Promise<Actor | null> {
    throw new Error('PostgresActorRepo not implemented yet');
  }
  async findAll(): Promise<Actor[]> {
    throw new Error('PostgresActorRepo not implemented yet');
  }
  async update(_id: string, _updates: Partial<Actor>): Promise<Actor | null> {
    throw new Error('PostgresActorRepo not implemented yet');
  }
}
