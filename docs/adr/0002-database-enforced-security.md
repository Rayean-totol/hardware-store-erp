# ADR 0002 — Security enforced in PostgreSQL (RLS + guarded RPCs)

**Status:** accepted (Phase 1)

## Context
Clients (browser, Android, Windows) are untrusted and hold the public anon key.

## Decision
Every `public` table has RLS. Permission checks use `SECURITY DEFINER` helpers in a
non-exposed `app` schema. Multi-row writes go through `SECURITY INVOKER` RPCs, so RLS still
applies. Field-level rules (price changes, archiving) are triggers. Tests verify RLS coverage,
`search_path` pinning, and that the permission matrix matches `@erp/domain`.

## Consequences
+ A compromised or buggy client cannot exceed its role.
− Policy helpers run per row. Index `memberships(user_id, org_id)` exists. Revisit with JWT
  custom claims if profiling shows overhead.
