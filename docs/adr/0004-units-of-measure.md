# ADR 0004 — Base-unit stock with per-product unit factors

**Status:** accepted (Phase 1)

## Decision
Each product has one base unit, and stock is always stored in it. `product_units` lists the
other units with `factor` = base units per unit, plus per-unit barcode, price and sale/purchase
flags. Standard conversions (cm↔m, dozen↔pcs) come from `units.ratio_to_dimension_base`
and are suggested in the UI. Packaging units (box, roll) are product-specific. Indivisible base
units (pcs) require whole-number factors.

## Consequences
+ One stock figure per product and branch. Any sale or purchase unit converts exactly.
− Changing a product's base unit after stock exists must be blocked or migrated. This will be
  enforced in Phase 2 once stock movements reference products.
