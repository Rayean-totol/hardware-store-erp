# ADR 0005 — Offline sync via idempotent commands (planned)

**Status:** proposed (implementation in Phase 2)

## Decision
Devices write to a local store and enqueue **commands** (same payloads as the online RPCs,
with client-generated IDs) in an outbox. The server applies them idempotently. Master data uses
optimistic concurrency (`row_version`). Transactional documents are append-only and owned by
the device that created them, numbered per device. See `docs/offline-sync.md`.
