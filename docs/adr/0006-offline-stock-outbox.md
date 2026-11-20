# ADR 0006 — Offline stock: outbox of idempotent movements, server snapshot per warehouse

**Status:** accepted (Phase 2). Implemented; the PostgREST/Supabase path is not yet verified.

## Context
Stores must keep selling and receiving goods when the internet drops. Retries after lost responses
must never double-count stock. Balances shown on a device must not drift from the server.

## Decision
* Movements are queued in a local outbox (IndexedDB; in-memory fallback that is **reported** as
  non-durable) with a device-generated `client_id`.
* The server applies each id at most once (`apply_stock_movements`), so the device can resend a batch
  after any failure.
* The displayed balance is the **last server snapshot** plus every queued movement the server has not
  yet reflected, replayed with the same costing rules.
* Lifecycle: `pending` → `acked` (server accepted or already had it) → removed when a fresh
  snapshot that includes it is stored. Removal and snapshot write happen in **one IndexedDB
  transaction**. `rejected` movements become `failed` and stay visible until retried or discarded.
* Entries are sent in device order. A backed-off entry blocks later ones, because moving-average
  cost depends on order.

## Consequences
+ Lost responses, crashes and restarts are covered by unit tests (fake server) and by the API test
  (`tests/db/src/api/inventory-offline.test.ts`, not yet run here).
+ Rejections are never silently dropped.
− Snapshots are full per warehouse (fine for thousands of products; delta sync is a later
  optimisation). Two devices selling the same last unit both succeed, and the balance goes negative
  when the org allows it. Conflict review for negative stock is not built yet.
− The app must be open (or reopened) for queued work to be sent. No background sync (no service
  worker or native background task yet — Phase 7).
