# Inventory (Phase 2)

Status: implemented and tested locally (domain, data layer, offline engine, database, web UI).
**Not yet verified:** the PostgREST API suite (`pnpm test:api`), real Supabase Auth/Storage, and
any browser flow that needs a signed-in session. See [implementation-plan.md](./implementation-plan.md).

## What a stock movement is

Every change to stock is one row in `public.stock_movements`: receipt (`stock_in`), issue
(`stock_out`) or `adjustment` (signed, always with a reason). Rows are **append-only**: no role,
including the database owner, can update or delete one (`stock_movements is append-only`). A
correction is a new movement.

* Quantities are stored in the product's **base unit**. The user enters a unit (box, roll, bag,
  kg…), and the server converts it with the factor configured on the product
  (`factor` snapshot stored on the movement). Example: 2 boxes of 200 screws → 400 pcs.
* Fractional quantities are allowed only where the base unit allows them (metres, kg, litres).
  Pieces cannot be split.
* Each movement stores the balance and the average cost **after** it, so history can be read
  without recomputation.

## Costing

Weighted moving average per warehouse and product, rounded to 4 decimals (half-up):

* Receipt: `new_avg = (qty × avg + in_qty × unit_cost_per_base) / (qty + in_qty)`. If the balance
  was zero or negative, the receipt cost becomes the average.
* Issue: costed at the current average; the average does not change.
* Cost is entered per **entered unit** and converted to per **base unit** (`box price ÷ factor`).
  The rounding to 4 decimals can differ from exact arithmetic by less than 0.0001 per base unit.

The same rules are implemented in `packages/domain/src/stock.ts` (`applyStockChange`) and in SQL
(`app.apply_one_stock_movement`). Both are tested against the same scenario: receive 2 boxes at
25.00, issue 50, receive 100 at 0.20 → average 0.1417; issue 500 → −50 with a `negative_stock`
warning. The database tests live in `tests/db/src/db/inventory.test.ts`.

## Negative stock

`organizations.allow_negative_stock` (default **true**). Offline sales can overdraw stock. When the
policy is on, the movement is applied and flagged `negative_stock`. When it is off, the server
rejects the movement with `stock.insufficient`, and the device refuses to queue it.

## Server write path

`public.apply_stock_movements(org, device, movements[])` is the only writer of `stock_movements` and
`stock_levels`:

* **Idempotent:** each movement carries a device-generated `client_id`. A repeated id returns
  `duplicate` with the stored balance and changes nothing.
* **Ordered:** items apply in array order inside one transaction.
* **Item isolation:** each item runs in its own savepoint. A rejection (unknown product, missing
  permission, insufficient stock…) is returned with its code and the others still apply.
* **Authoritative:** base quantity, factor, cost and balances are computed on the server.
* **Permissions per item:** `inventory.move` for receipts and issues, `inventory.adjust` for
  adjustments, and branch access for the warehouse's branch.

Read functions: `list_stock_levels`, `list_low_stock`, `list_stock_movements` (all `security
invoker`, so RLS applies). Quantities are returned as text to keep 6-decimal precision.

## Warehouses and branches

Each branch has a default warehouse with the branch code (created by trigger, back-filled for
existing branches). Additional warehouses can be created by `warehouse.manage`. A warehouse belongs
to one branch; stock rows reference `(warehouse, branch, org)`, so a branch cannot disagree with its
warehouse. Branch-restricted users see and post only to their branches.

## Reorder levels and low-stock alerts

`products.reorder_level` (base units, Phase 1). A product is low when its balance in a warehouse is
at or below the level. Products never stocked in a warehouse count as zero and are alerted too.
The stock screen shows the same rule locally, so it works offline.

## Prices

`product_units.sale_price` stays the base retail price. `product_prices` adds wholesale and trade
prices and quantity breaks per unit. Resolution: highest break reached in the requested level, then
retail breaks, then the base price (`resolve_sale_price` in SQL, `resolveSalePrice` in the domain).
Changing a price needs `catalog.price_write`, also when rows are edited directly. Saving a product's
tiers does not rewrite unchanged rows, so storekeepers can save products they may not reprice.

## Product data

* **Images:** stored in the Supabase Storage bucket `product-images` at `<org>/<product>/<file>`.
  Read follows org membership; write follows `catalog.write`. Paths are checked in the database
  (`products.image_path`). The bucket policies are tested against a test shim of `storage.objects`
  only. **The real Storage service has not been exercised.**
* **Barcodes:** EAN-13/EAN-8/UPC-A with valid check digits are GTINs; other codes are Code 128.
  Labels are rendered with `bwip-js` (SVG). In-store EAN-13 codes (prefix 20–29) can be generated.
* **Bulk import/export:** CSV, one row per unit (see the header in
  `packages/domain/src/product-csv.ts`). The import **plans** first and reports problems per CSV
  line (dry run); nothing is written until the user confirms. Existing SKUs are updated with
  optimistic concurrency. Each product is saved independently, so one failure does not stop the
  rest, and every outcome is listed. Export uses a UTF-8 byte-order mark so spreadsheets open
  Arabic and Bangla correctly. Values that start with `= + - @` are escaped (CSV injection).

## Scanning

Keyboard-wedge scanners (they type the code and press Enter) work in the movement form. Camera
scanning is **not implemented**.

## Screens

| Route | Purpose | Permission |
| --- | --- | --- |
| `/inventory/` | Stock per warehouse, low-stock flags, sync panel | `inventory.read` |
| `/inventory/move/` | Stock in, stock out, adjustments with preview | `inventory.move` / `inventory.adjust` |
| `/inventory/history/` | Movement history (online only) | `inventory.read` |
| `/warehouses/` | Warehouses per branch | `warehouse.manage` to change |
| `/labels/` | Barcode label sheet and printing | `catalog.read` |
| `/products/import/` | CSV import with preview | `catalog.write` |

## Not in Phase 2

Inter-warehouse transfers (a receipt plus an issue is not yet a single document), stock counts as a
workflow (adjustments only), valuation reports, camera barcode scanning, server-side label
generation, product variants, and cost layers other than the moving average.
