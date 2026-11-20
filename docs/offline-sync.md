# Offline sync — design (Phase 2)

> Status: design only. Phase 1 is online-only. The Phase 1 schema already follows the rules below.

## Principles

1. **The server is authoritative for master data; devices are authoritative for what physically
   happened.** A sale made offline happened. The server must accept it, even if stock went negative
   or the price changed meanwhile. It records an exception for review instead of rejecting it.
2. **Commands, not row diffs.** The client records intent (`pos.sale.create`, `catalog.product.save`)
   in an outbox with the full payload and a client-generated ID. Replaying a command is
   idempotent: same ID, same result.
3. **Monotonic per-device sequences.** Document numbers are `{branch}-{device}-{seq}`, allocated
   locally, so they can never collide.
4. **Pull by cursor.** Each synced table exposes `row_version` and `updated_at`. Devices pull
   rows changed since their last cursor, scoped by RLS to what the user may see.

## Components

```
UI ─► repository (same interface as online) ─► local store (SQLite / IndexedDB)
                                               │
                                               ├─► outbox (command, payload, id, attempts, last_error)
                                               │        └─► push worker ─► RPC (idempotent) ─► Postgres
                                               └─◄ pull worker ◄─ select … where row_version > cursor
```

* Browser: IndexedDB (Dexie). Capacitor: `@capacitor-community/sqlite`. Tauri: `tauri-plugin-sql`
  (SQLite). The storage driver sits behind one interface.
* Conflicts on master data: the client sends `row_version`. A stale write gets
  `concurrency_conflict`, and the user sees both versions and decides. Conflicts on
  transactional data cannot happen, because each document is append-only and owned by its device.
* Failed commands are never dropped silently. They stay in the outbox with the error visible in
  a "Sync issues" screen until resolved.

## Phase 1 schema readiness checklist

- [x] UUID PKs with `gen_random_uuid()` default, client may supply its own
- [x] `row_version` and `updated_at` maintained by `app.touch_row()`
- [x] Optimistic concurrency in `save_product` (`p_expected_version`)
- [x] Soft archive instead of delete for products
- [x] `x-device-id` header captured in the audit log
