import { TraceEvent } from '../../domain/types';
import { IEventRepo } from '../interfaces';

// TODO: implement using `pg` Pool — see migrations/001_init.sql for schema.
export class PostgresEventRepo implements IEventRepo {
  async create(_event: TraceEvent): Promise<TraceEvent> {
    throw new Error('PostgresEventRepo not implemented yet');
  }
  async findByBatchId(_batchId: string): Promise<TraceEvent[]> {
    throw new Error('PostgresEventRepo not implemented yet');
  }
  async findById(_id: string): Promise<TraceEvent | null> {
    throw new Error('PostgresEventRepo not implemented yet');
  }
  async findLastByBatchId(_batchId: string): Promise<TraceEvent | null> {
    throw new Error('PostgresEventRepo not implemented yet');
  }
  async countByBatchId(_batchId: string): Promise<number> {
    throw new Error('PostgresEventRepo not implemented yet');
  }
}
