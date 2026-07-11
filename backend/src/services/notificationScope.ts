import { Batch, TraceEvent } from '../domain/types';

/**
 * Who should actually see a notification about this batch: whoever created
 * it, whoever currently holds custody, and everyone who has ever recorded an
 * event on it. Used by both the polling `/notifications` endpoint and the
 * Socket.IO realtime push, so the two channels can't drift out of sync with
 * each other (they used to — the socket channel broadcast to everyone).
 */
export function getInvolvedActorIds(events: TraceEvent[], batch: Pick<Batch, 'createdBy' | 'assignedToActorId'>): string[] {
  const ids = new Set<string>();
  ids.add(batch.createdBy);
  if (batch.assignedToActorId) ids.add(batch.assignedToActorId);
  for (const event of events) ids.add(event.actorId);
  return [...ids];
}
