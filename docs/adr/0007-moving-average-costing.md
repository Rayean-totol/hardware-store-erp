# ADR 0007 — Weighted moving-average costing per warehouse and product

**Status:** accepted (Phase 2)

## Decision
Cost of goods is the weighted moving average per (warehouse, product), in base units, rounded to 4 dp
half-up. Receipts re-average (or set the cost if the balance was not positive), issues are costed at
the current average. The same formula runs in SQL and in TypeScript; both are tested on one scenario.

## Consequences
+ Simple, deterministic and reproducible offline.
+ Each movement stores the average after it, so history shows the cost basis without recomputation.
− Not FIFO/LIFO and not actual lot costing. Lot tracking (expiry, serials) is out of scope. Rounding
  can differ from exact arithmetic by under 0.0001 per base unit.
