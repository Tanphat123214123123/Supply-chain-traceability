import { Pool } from 'pg';
import { SupplyChainStage, TraceEvent } from '../../domain/types';
import { IEventRepo } from '../interfaces';

interface EventRow {
  id: string;
  batch_id: string;
  stage: SupplyChainStage;
  actor_id: string;
  timestamp: Date;
  location: string;
  notes: string | null;
  data: Record<string, unknown>;
  hash: string;
  prev_hash: string;
  sequence_number: number;
}

function toEvent(row: EventRow): TraceEvent {
  return {
    id: row.id,
    batchId: row.batch_id,
    stage: row.stage,
    actorId: row.actor_id,
    timestamp: row.timestamp,
    location: row.location,
    notes: row.notes ?? undefined,
    data: row.data,
    hash: row.hash,
    prevHash: row.prev_hash,
    sequenceNumber: row.sequence_number,
  };
}

export class PostgresEventRepo implements IEventRepo {
  constructor(private readonly pool: Pool) {}

  async create(event: TraceEvent): Promise<TraceEvent> {
    await this.pool.query(
      `INSERT INTO trace_events (id, batch_id, stage, actor_id, timestamp, location, notes, data, hash, prev_hash, sequence_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.id,
        event.batchId,
        event.stage,
        event.actorId,
        event.timestamp,
        event.location,
        event.notes ?? null,
        JSON.stringify(event.data ?? {}),
        event.hash,
        event.prevHash,
        event.sequenceNumber,
      ],
    );
    return event;
  }

  async findByBatchId(batchId: string): Promise<TraceEvent[]> {
    const result = await this.pool.query<EventRow>(
      'SELECT * FROM trace_events WHERE batch_id = $1 ORDER BY sequence_number ASC',
      [batchId],
    );
    return result.rows.map(toEvent);
  }

  async countAll(): Promise<number> {
    const result = await this.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM trace_events');
    return Number(result.rows[0]?.count ?? 0);
  }

  async lastEvent(batchId: string): Promise<Pick<TraceEvent, 'sequenceNumber' | 'hash'> | null> {
    const result = await this.pool.query<{ sequence_number: number; hash: string }>(
      'SELECT sequence_number, hash FROM trace_events WHERE batch_id = $1 ORDER BY sequence_number DESC LIMIT 1',
      [batchId],
    );
    const row = result.rows[0];
    return row ? { sequenceNumber: row.sequence_number, hash: row.hash } : null;
  }
}
