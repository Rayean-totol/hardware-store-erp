# Migration: product size and purchase price

File: `supabase/migrations/20261127000100_product_size_and_purchase_price.sql`

**Status: prepared and tested on a local database. Not applied to your live database.**

## What it changes

| Object | Change | Existing data |
|---|---|---|
| `products.size_label` | new nullable text column (1 to 40 characters) | every existing product: NULL |
| `products.variant_group` | new nullable text column (1 to 40 characters): shared code for sizes or versions of one item | every existing product: NULL |
| `product_unit_costs` | new table: purchase price per product unit | empty for every existing product |
| Row policies on `product_unit_costs` | readable and writable only with `catalog.price_write` | n/a |
| `save_product` | accepts `size_label`, `variant_group` and unit `purchase_price`; absent keys keep stored values | unchanged for existing callers |

Nothing is deleted, updated or renamed. Selling prices (`product_units.sale_price`) and their guard are not changed.

## Why it is needed

- The product had no size field.
- The app stored a selling price per unit, but had no purchase price per unit. Stock records carry only
  the calculated average cost.

## Safety properties (tested)

- Existing callers (the CSV import, older clients) do not send the new keys, so their saves keep the stored size and cost.
- A storekeeper (catalogue write, no price permission) cannot set or read a purchase price. Tested.
- Negative and over-precise prices are refused. Sizes over 40 characters are refused. Tested.
- Adding the table adds no change to stock levels or stock movements. Tested.
- The database privilege matrix lists the new table with its exact grants, and the migration test
  passes on a fresh build.

## Steps to apply (only after your approval)

1. **Backup.** Supabase dashboard, Database, Backups. Confirm a recent backup exists.
2. **Preflight (read-only).** Run `supabase/checks/product_size_cost_preflight.sql` in the SQL Editor.
   Expect `size_label column present` = `no`, `product_unit_costs table present` = `no`, and no
   change in the row counts you wrote down.
3. **Apply.** Paste the migration file into the SQL Editor and run it once. It is additive; if it
   fails, nothing is changed.
4. **Verify (read-only).** Run `supabase/checks/product_size_cost_verify.sql`. Expect every line `ok`
   and the same row counts as in step 2.
5. Deploy the frontend that uses these fields (a separate approval).

## Rollback

Dropping the new table or column would delete purchase prices and sizes entered after the migration.
Do not roll back unless you have confirmed that nothing has been entered, or you have restored from the
backup in step 1. Existing data is not affected by the migration itself.
