/** Escapes LIKE/ILIKE metacharacters so user input is matched literally (Postgres' default escape is `\`). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * SQL predicate: the batch aliased `alias` was created by, is currently held
 * by, or has an event recorded by the actor bound to `param`. The single
 * definition of "involved in a batch", shared by notification queries and
 * mirrored by services/notificationScope.ts for realtime pushes.
 */
export function involvesActor(param: string, alias = 'b'): string {
  return `(${alias}.created_by = ${param}
        OR ${alias}.assigned_to_actor_id = ${param}
        OR EXISTS (SELECT 1 FROM trace_events ie WHERE ie.batch_id = ${alias}.id AND ie.actor_id = ${param}))`;
}

/** `count(*) OVER ()` comes back as text from pg (bigint); rows carry it alongside their own columns. */
export interface WithTotal {
  total_count: string;
}
