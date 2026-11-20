# ADR 0003 — Decimal arithmetic for quantities and money

**Status:** accepted (Phase 1)

## Decision
All quantities, factors and amounts are decimal strings in transport, `numeric` in Postgres
(selected as `::text` through PostgREST so precision survives JSON), and `decimal.js` in
TypeScript. VAT is computed per line, rounded half-up to 2 dp, with `vat = gross − net`, so
totals always reconcile.

## Consequences
+ No floating-point drift in invoices or stock.
− Slightly more verbose code; `Number()` on business values is a code-review red flag.
