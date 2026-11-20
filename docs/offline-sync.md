# Offline sync (Phase 2 — implemented)

Read with [adr/0006](./adr/0006-offline-stock-outbox.md) and [inventory.md](./inventory.md).

## What works, and how it was tested

| Guarantee | Test |
| --- | --- |
| Movements are queued without the network, and the device shows the result immediately | `packages/data/test/sync-engine.test.ts` (queueing and projection) |
| A network failure before the server applies a batch keeps everything queued with back-off | `sync-engine.test.ts` ("network failure keeps everything queued") |
| A lost response (server applied, device did not hear) does not double-count after retry | `sync-engine.test.ts` ("lost response"); **API version through PostgREST:** `tests/db/src/api/inventory-offline.test.ts` (not yet run) |
| A failed snapshot refresh keeps acknowledged movements visible until the snapshot is stored | `sync-engine.test.ts` ("failed snapshot refresh") |
| Rejected movements stay visible with the server's code; retry or discard | `sync-engine.test.ts`, `packages/data/test/store-contract.test.ts`, `apps/web/test/inventory.test.tsx` |
| Restart: a new engine on the same store finishes the queue | `sync-engine.test.ts` ("survives a restart") |
| Back-off blocks later movements so the device order is kept | `sync-engine.test.ts` |
| IndexedDB keeps the outbox across a reopen | `store-contract.test.ts` (fake-indexeddb) |
| The database rejects duplicate ids and applies each id once | `tests/db/src/db/inventory.test.ts` |

## Model

```
device                                         server
──────                                         ──────
outbox: pending → acked → (removed)            apply_stock_movements(batch)
        pending → failed (kept for review)       ├ new client_id   → applied
                                                 ├ known client_id → duplicate (no effect)
snapshot per warehouse (server levels)           └ invalid         → rejected (code)
projection = snapshot + outbox (in seq order)
```

* Local validation (`enqueue`) runs the same checks as the server, so the user sees problems before
  queueing: unknown or service products, unit not configured, fractions, precision, cost, reason,
  and overdraw when the org disallows negative stock.
* `flush()` is single-flight. Batches are at most 50 movements. A transport error keeps the batch
  queued and sets an exponential back-off (1 s doubling, capped at 5 min).
* After acknowledgement the warehouse snapshot is refreshed, and the acknowledged entries are removed
  in the same IndexedDB transaction.
* The catalog (products, units, barcodes, reorder levels, the org's negative-stock policy) is
  cached for offline lookup and validation. Downloading it requires a connection.

## Limits (honest list)

* **Verification gap:** the PostgREST path (JSON shapes, RLS through HTTP) is covered by tests that
  have not run in this environment. Run `scripts/fetch-postgrest.sh && pnpm test:api` before relying on it.
* **Only while the app runs.** Queued work is sent when the page is open and online, on the `online`
  event and every 20 s. Nothing sends it when the browser is closed; that needs a service worker
  (PWA) or the native background tasks of Phase 7.
* **Multiple tabs are untested.** Two tabs of the same app would share one outbox and each run an
  engine. The server's idempotency should prevent double-counting, but local reads can show briefly
  stale figures and that has not been tested. Keep one tab open.
* **Negative stock is not reviewed.** Two devices can sell the last unit at the same time. With
  negative stock allowed (the default) both succeed and the balance goes negative, flagged
  `negative_stock`. A review screen does not exist yet.
* **Master data** is not synchronised offline. Product edits need a connection; the only protection is
  the optimistic version check on `save_product`.
* **Full snapshots per warehouse** instead of deltas. Fine at hardware-store scale; revisit when a
  warehouse has tens of thousands of products.
* **Clock:** `occurred_at` is the device clock. A wrong device clock records wrong times. Server time
  (`recorded_at`) is always correct and is what history sorts by.
