import { Batch } from '../../domain/types';
import { IBatchRepo } from '../interfaces';

// TODO: implement using `pg` Pool — see migrations/001_init.sql for schema.
// Replace InMemoryBatchRepo with this class when wiring up PostgreSQL.
export class PostgresBatchRepo implements IBatchRepo {
  async create(_batch: Batch): Promise<Batch> {
    throw new Error('PostgresBatchRepo not implemented yet');
  }
  async findById(_id: string): Promise<Batch | null> {
    throw new Error('PostgresBatchRepo not implemented yet');
  }
  async findAll(): Promise<Batch[]> {
    throw new Error('PostgresBatchRepo not implemented yet');
  }
  async update(_id: string, _updates: Partial<Batch>): Promise<Batch | null> {
    throw new Error('PostgresBatchRepo not implemented yet');
  }
}
