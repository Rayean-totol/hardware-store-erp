# POS and sales (Phase 3)

Migration: `supabase/migrations/20261124000100_pos_sales.sql` (additive; apply after the existing set).

## What the database does

| Object | Purpose |
| --- | --- |
| `public.finalize_sale(...)` | One transaction per checkout. Validates the branch, warehouse, customer, lines and payments; prices, discounts and VAT on the server; locks stock; writes the sale, lines and payments; deducts stock through `apply_stock_movements`. Any failure rolls back everything. |
| `public.cancel_sale(...)` | Controlled reversal: stock returns through a `stock_in` movement (reason `return`) at the cost recorded when sold. The sale is marked `voided`. Nothing is deleted. |
| `sales`, `sale_lines`, `sale_payments` | Invoice documents. Read-only for signed-in users (RLS: `sales.read` and branch access). Lines and payments are append-only by trigger. |
| `customers` | Minimal customer record with `credit_allowed`. The Customer Ledger module will extend it. |
| `invoice_counters` | One row per organisation, branch and fiscal year. Row lock makes invoice numbers unique under concurrency: `INV-<branch code>-<year>-<six digits>`. |

Idempotency: a checkout is keyed by `client_id`. A replay returns the stored sale (`status: duplicate`) and writes nothing. Stock movements have deterministic ids derived from the sale key.

## Rules (server authoritative; mirrored in `packages/domain/src/sales.ts`)

* Prices are VAT-inclusive or exclusive per organisation (`prices_include_vat`).
* Discounts (percent or fixed) are applied before VAT. Percent discounts are rounded to 2 dp per line.
* VAT rate: `organizations.standard_vat_rate` (15% by default) for product tax category `S`; zero for `Z`, `E`, `O`.
* Cash may be tendered above the amount applied (change). Other methods cannot overpay.
* A balance left after payment is recorded as a `credit` payment. It needs `sales.credit` and a customer with `credit_allowed`.
* Stock: sales are refused when the warehouse does not hold enough, even if the organisation allows negative stock.

## Permissions

| Permission | owner | admin | manager | cashier | accountant / auditor |
| --- | :-: | :-: | :-: | :-: | :-: |
| `sales.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sales.create` | ✓ | ✓ | ✓ | ✓ | |
| `sales.discount` | ✓ | ✓ | ✓ | | |
| `sales.price_override` | ✓ | ✓ | ✓ | | |
| `sales.credit` | ✓ | ✓ | ✓ | | |
| `sales.void` | ✓ | ✓ | ✓ | | |
| `customers.manage` | ✓ | ✓ | ✓ | | |

Enforced in the database (the RPCs check permissions and branch access; RLS limits reads). The web screen only hides controls.

## Web screen (`/pos/`)

Product search by SKU, name or barcode; scanners that type and press Enter add one unit on an exact match. Cart with quantity, discount and price override (only where permitted). Cash, card and transfer entry, change, credit balance. Hold and resume on this device. Recent sales. Browser print for the receipt.

## Not in this phase (be explicit)

* Returns and refunds. Only cancellation exists.
* Offline POS. Checkout is refused while offline, because stock, numbering and tax need server confirmation.
* Held carts are stored per device only.
* Receipts: browser print only. No 58/80 mm or A4 templates, no PDF export, no QR code.
* Reports, dashboard integration, and profit figures.
* Camera barcode scanning and recent/frequent product lists.
* ZATCA Phase 2 integration. Receipts make no compliance claim.
* Customer creation in the UI (customers are created in the database for now).
* The screen uses the 15% rate for its live preview. The server total is authoritative and is shown on the receipt.

## Tests

* `packages/domain/test/sales.test.ts`: VAT-inclusive and exclusive lines, rounding, discounts, overrides, payments.
* `tests/db/src/db/pos.test.ts`: totals equal the domain rules, stock deduction, numbering, replay, insufficient stock, credit, permissions, branch isolation, cancellation, immutability.
* `tests/db/src/db/pos-concurrency.test.ts` (own database, committed transactions): simultaneous checkouts for the last units, double submit, many concurrent invoices.
* `tests/db/src/api/pos-rpc.test.ts` (own database, real PostgREST with signed JWTs).
* `apps/web/test/pos.test.tsx`: add, totals, cash change, credit gating, role controls, hold/resume, scanner, offline.

## After deployment: the POS / Sales menu is missing

The menu item is shown only when the signed-in user has `sales.read`. The app gets that list from `get_my_context()`, which reads the live database. So the menu stays hidden until the Phase 3 migration has been run on the Supabase project. Merging the pull request and deploying the site do not change the database.

1. Run `supabase/checks/phase3_pos_verify.sql` in the Supabase SQL editor. It only reads. Every row should be `true`.
2. If any row is `false`, back up the project first, then run `supabase/migrations/20261124000100_pos_sales.sql` once in the SQL editor. It is safe to run again: it creates only what is missing and adds role grants without removing any.
3. Run the check again, then sign out and sign in again so the permission list reloads.

The check file is kept outside `supabase/migrations/` on purpose, so it is never applied automatically.
