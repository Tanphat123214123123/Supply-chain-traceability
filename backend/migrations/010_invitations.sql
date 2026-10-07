-- 010: Invitation-only membership.
--
-- Before this, anyone who knew (or guessed) a workspace slug could register
-- into that tenant AND pick their own role — including INSPECTOR, which can
-- recall batches. Now a tenant is joined only through an invitation an ADMIN
-- issued, and the role comes from the invitation, never from the registrant.
--
-- The raw invite code is shown to the admin exactly once; only its SHA-256
-- digest is stored (same reasoning as refresh tokens: a high-entropy random
-- value needs no slow hash, and a leaked backup reveals no usable code).

CREATE TABLE invitations (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  code_hash   CHAR(64) NOT NULL UNIQUE,
  role        TEXT NOT NULL CHECK (role IN ('FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER', 'ADMIN')),
  -- Optional: when set, only this email may redeem the invitation.
  email       TEXT,
  note        TEXT,
  created_by  UUID NOT NULL REFERENCES actors(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     UUID REFERENCES actors(id),
  revoked_at  TIMESTAMPTZ,
  CONSTRAINT invitations_used_consistent CHECK ((used_at IS NULL) = (used_by IS NULL))
);

CREATE INDEX idx_invitations_tenant_created ON invitations (tenant_id, created_at DESC);

GRANT SELECT, INSERT ON invitations TO tracechain_app;
GRANT UPDATE (used_at, used_by, revoked_at) ON invitations TO tracechain_app;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Pre-tenant: a registrant holds only the code. Returns the invitation's
-- tenant (plus what the sign-up form needs to show) for a code that is still
-- redeemable; nothing at all for a used, revoked, expired or unknown code.
CREATE FUNCTION auth_resolve_invitation(p_code_hash text)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, tenant_name text, role text, email text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.id, i.tenant_id, t.name, i.role, i.email, i.expires_at
    FROM invitations i
    JOIN tenants t ON t.id = i.tenant_id
   WHERE i.code_hash = p_code_hash
     AND i.used_at IS NULL
     AND i.revoked_at IS NULL
     AND i.expires_at > now()
$$;

REVOKE ALL ON FUNCTION auth_resolve_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_invitation(text) TO tracechain_app;
