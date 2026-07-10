import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { Actor, Anomaly, AuditLogEntry, Batch, Tenant, TraceEvent } from '../domain/types';
import { InMemoryActorRepo } from '../repository/memory/actorRepo';
import { InMemoryAnomalyRepo } from '../repository/memory/anomalyRepo';
import { InMemoryAuditLogRepo } from '../repository/memory/auditLogRepo';
import { InMemoryBatchRepo } from '../repository/memory/batchRepo';
import { InMemoryEventRepo } from '../repository/memory/eventRepo';
import { InMemoryTenantRepo } from '../repository/memory/tenantRepo';

export interface SnapshotableRepos {
  tenantRepo: InMemoryTenantRepo;
  actorRepo: InMemoryActorRepo;
  batchRepo: InMemoryBatchRepo;
  eventRepo: InMemoryEventRepo;
  anomalyRepo: InMemoryAnomalyRepo;
  auditLogRepo: InMemoryAuditLogRepo;
}

interface SnapshotFile {
  tenants: Tenant[];
  actors: Actor[];
  batches: Batch[];
  events: TraceEvent[];
  anomalies: Anomaly[];
  auditLogs: AuditLogEntry[];
}

// JSON has no Date type — `JSON.stringify` turns every Date into an ISO
// string, so this reviver turns them back on the way in. Deliberately NOT
// snapshotting refreshTokenRepo: forcing a re-login after a restart is
// acceptable and safer than persisting session tokens to a plain JSON file.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function reviveDates(_key: string, value: unknown): unknown {
  return typeof value === 'string' && ISO_DATE.test(value) ? new Date(value) : value;
}

/** Loads a previously written snapshot (if any) into the given in-memory repos. Returns true if any data was actually loaded. */
export function loadSnapshot(repos: SnapshotableRepos, filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const raw = readFileSync(filePath, 'utf-8');
  if (!raw.trim()) return false;

  const data = JSON.parse(raw, reviveDates) as SnapshotFile;
  repos.tenantRepo._load(data.tenants ?? []);
  repos.actorRepo._load(data.actors ?? []);
  repos.batchRepo._load(data.batches ?? []);
  repos.eventRepo._load(data.events ?? []);
  repos.anomalyRepo._load(data.anomalies ?? []);
  repos.auditLogRepo._load(data.auditLogs ?? []);
  return (data.actors?.length ?? 0) > 0 || (data.batches?.length ?? 0) > 0;
}

function writeSnapshot(repos: SnapshotableRepos, filePath: string): void {
  const data: SnapshotFile = {
    tenants: repos.tenantRepo._dump(),
    actors: repos.actorRepo._dump(),
    batches: repos.batchRepo._dump(),
    events: repos.eventRepo._dump(),
    anomalies: repos.anomalyRepo._dump(),
    auditLogs: repos.auditLogRepo._dump(),
  };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data), 'utf-8');
}

/**
 * Periodically flushes in-memory data to a local JSON file so restarting the
 * process (without Postgres configured) doesn't lose everything — plus a
 * final flush on SIGINT/SIGTERM so a clean shutdown never loses the last
 * few seconds of writes. Returns a stop function (used by tests).
 */
export function startSnapshotting(repos: SnapshotableRepos, filePath: string, intervalMs = 15_000): () => void {
  const interval = setInterval(() => writeSnapshot(repos, filePath), intervalMs);
  interval.unref(); // a pending snapshot timer alone shouldn't keep the process alive

  const flushAndExit = () => {
    writeSnapshot(repos, filePath);
    process.exit(0);
  };
  process.on('SIGINT', flushAndExit);
  process.on('SIGTERM', flushAndExit);

  return () => clearInterval(interval);
}
