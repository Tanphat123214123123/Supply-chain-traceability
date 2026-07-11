-- Chain-of-custody hand-off: tracks which single actor is currently
-- authorized to record a batch's next event.

ALTER TABLE batches ADD COLUMN IF NOT EXISTS assigned_to_actor_id UUID REFERENCES actors(id);

CREATE INDEX IF NOT EXISTS idx_batches_assigned_to ON batches (assigned_to_actor_id);
