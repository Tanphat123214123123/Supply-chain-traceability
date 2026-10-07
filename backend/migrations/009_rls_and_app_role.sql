-- 009: Least-privilege application role + row-level security.
--
-- The API server connects as `tracechain_app`, never as the schema owner:
--   • no DDL, no TRUNCATE, no DELETE on business tables;
--   • INSERT + SELECT only on the append-only ledger (trace_events, audit_logs);
--   • UPDATE only on the specific columns a workflow legitimately changes —
--     notably NOT batches.head_hash / event_count (trigger-maintained), nor
--     tenant_id / created_by anywhere;
--   • every tenant-owned row is filtered by RLS against `app.tenant_id`,
--     which the application sets per transaction (src/db/database.ts).
--
-- The handful of operations that genuinely happen before a tenant is known
-- (login by email, refresh-token exchange, the public QR lookup) go through
-- narrow SECURITY DEFINER functions instead of a blanket RLS bypass.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tracechain_app') THEN
    -- NOLOGIN here; `npm run migrate` with APP_DB_PASSWORD set grants LOGIN.
    CREATE ROLE tracechain_app NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO tracechain_app;

-- ── Table privileges ────────────────────────────────────────────────────────
GRANT SELECT ON schema_migrations TO tracechain_app;   -- startup "schema up to date?" check

GRANT SELECT, INSERT ON tenants TO tracechain_app;

GRANT SELECT, INSERT ON actors TO tracechain_app;
GRANT UPDATE (name, organization, role, is_active, password_hash) ON actors TO tracechain_app;

GRANT SELECT, INSERT ON batches TO tracechain_app;
GRANT UPDATE (current_stage, assigned_to_actor_id, is_recalled, recall_reason) ON batches TO tracechain_app;

GRANT SELECT, INSERT ON trace_events TO tracechain_app;

GRANT SELECT, INSERT ON anomalies TO tracechain_app;
GRANT UPDATE (resolved, resolved_by, resolved_at) ON anomalies TO tracechain_app;

GRANT SELECT, INSERT ON audit_logs TO tracechain_app;

GRANT SELECT, INSERT ON refresh_tokens TO tracechain_app;
GRANT UPDATE (revoked) ON refresh_tokens TO tracechain_app;

-- ── Row-level security ──────────────────────────────────────────────────────
-- current_setting(..., true) returns NULL/'' when unset → no row matches, so
-- a query issued outside a tenant transaction fails closed (sees nothing,
-- can write nothing) rather than open.
CREATE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

ALTER TABLE actors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE trace_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomalies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON actors
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON batches
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON trace_events
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON anomalies
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON audit_logs
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON refresh_tokens
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- ── Pre-tenant entry points (SECURITY DEFINER, minimal surface) ─────────────
-- Each returns only identifiers needed to then open a properly scoped
-- tenant transaction; none returns business data.

-- Public QR / provenance lookup: which tenant owns this batch?
CREATE FUNCTION resolve_batch_tenant(p_batch_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT b.tenant_id FROM batches b WHERE b.id = p_batch_id
$$;

-- Login and registration: email is globally unique (idx_actors_email_lower).
CREATE FUNCTION auth_lookup_actor(p_email text) RETURNS TABLE (actor_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT a.id, a.tenant_id FROM actors a WHERE lower(a.email) = lower(p_email)
$$;

-- Refresh-token rotation in ONE statement: check-and-revoke is atomic, so two
-- concurrent requests presenting the same token can't both get new sessions.
CREATE FUNCTION auth_consume_refresh_token(p_token_hash text) RETURNS TABLE (actor_id uuid, tenant_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE refresh_tokens t
     SET revoked = true
   WHERE t.token = p_token_hash
     AND NOT t.revoked
     AND t.expires_at > now()
  RETURNING t.actor_id, t.tenant_id
$$;

-- Logout carries only the refresh cookie, no access token → no tenant yet.
CREATE FUNCTION auth_revoke_refresh_token(p_token_hash text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE refresh_tokens SET revoked = true WHERE token = p_token_hash
$$;

-- Housekeeping across all tenants: expired/revoked sessions past a grace period.
CREATE FUNCTION purge_stale_refresh_tokens(p_grace interval DEFAULT interval '7 days') RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM refresh_tokens
   WHERE expires_at < now() - p_grace
      OR (revoked AND created_at < now() - p_grace);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION resolve_batch_tenant(uuid)              FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_lookup_actor(text)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_consume_refresh_token(text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_revoke_refresh_token(text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_stale_refresh_tokens(interval)    FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger_append_event()                   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION resolve_batch_tenant(uuid)           TO tracechain_app;
GRANT EXECUTE ON FUNCTION auth_lookup_actor(text)              TO tracechain_app;
GRANT EXECUTE ON FUNCTION auth_consume_refresh_token(text)     TO tracechain_app;
GRANT EXECUTE ON FUNCTION auth_revoke_refresh_token(text)      TO tracechain_app;
GRANT EXECUTE ON FUNCTION purge_stale_refresh_tokens(interval) TO tracechain_app;
