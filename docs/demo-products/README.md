# DEMO products: import, images and checks

Status: **prepared, not imported.** Nothing has been written to any database. The import is a
production data change, so it runs only after your approval.

## What is included

| Item | File |
|---|---|
| 10 products (English and Saudi Arabic names, categories, units, SAR prices) | `demo-products.csv` |
| 10 DEMO images (illustrations, each with a red DEMO band) | `images/*.png` |
| Read-only checks | `supabase/checks/demo_products_verify.sql` |
| Image generator (repeatable) | `scripts/demo-products/generate_images.py` |

| SKU | English name | Arabic name | Category | Unit | SAR |
|---|---|---|---|---|---|
| DEMO-PVC-PIPE | PVC Pipe (DEMO) | ماسورة PVC (تجريبي) | Plumbing | m | 12 |
| DEMO-PVC-ELBOW | PVC Elbow (DEMO) | كوع PVC (تجريبي) | Plumbing | pcs | 3 |
| DEMO-LED-BULB | LED Bulb (DEMO) | لمبة LED (تجريبي) | Electrical | pcs | 8 |
| DEMO-ELEC-CABLE | Electrical Cable (DEMO) | كيبل كهرباء (تجريبي) | Cables & wires | m | 45 |
| DEMO-CEMENT-BAG | Cement Bag (DEMO) | كيس أسمنت (تجريبي) | Building materials | bag | 18 |
| DEMO-HAMMER | Hammer (DEMO) | مطرقة (تجريبي) | Hand tools | pcs | 15 |
| DEMO-ADJ-WRENCH | Adjustable Wrench (DEMO) | مفتاح إنجليزي (تجريبي) | Hand tools | pcs | 22 |
| DEMO-MEAS-TAPE | Measuring Tape (DEMO) | شريط قياس (تجريبي) | Hand tools | pcs | 10 |
| DEMO-BOLT-NUT | Bolt & Nut (DEMO) | برغي وصامولة (تجريبي) | Bolts & nuts | pcs | 2 |
| DEMO-PL-BUCKET | Plastic Bucket (DEMO) | سطل بلاستيك (تجريبي) | Building materials | bucket | 9 |

Rules these products follow: no barcode, no stock quantity, no brand, one selling unit each, standard
VAT category, and no existing product is changed. Only SKUs starting with `DEMO-` are touched.

## What was verified before any import

- The app's own product importer plans the file with **10 creates, 0 updates, 0 invalid rows**
  (`tests/db/src/db/demo-products-csv.test.ts`).
- The database save function (`save_product`) accepts the rows as the owner user. A second run
  updates the same ten products and creates no duplicates. An existing image is kept. No stock
  row or movement changes, and every other product is identical. (One transaction, always rolled
  back: `tests/db/src/db/demo-products.test.ts`.)
- The read-only checks run correctly on a copy of the schema.

Not yet verified: the import on your live project, and the image uploads (they need your login).

## Steps (do them in this order, each after your approval)

**Step 1 — check the current state (read-only).** In Supabase → SQL Editor, paste
`supabase/checks/demo_products_verify.sql` from GitHub and run it. Expected now: `DEMO products found`
= `0`. Send me the table.

**Step 2 — backup.** Supabase → Database → Backups. Confirm a recent backup exists.

**Step 3 — import the CSV in the app (creates the 10 products).**
1. Get the file on your phone: open
   `https://raw.githubusercontent.com/Rayean-totol/hardware-store-erp/feature/demo-products/docs/demo-products/demo-products.csv`
   in Chrome and save it (or copy it from the page).
2. Open the app, go to **Products → Import**, choose the file.
3. Read the plan. It must show **Create 10, Update 0, Invalid 0**. If anything else shows, stop and
   send me a screenshot. Do not confirm.
4. Confirm the import.

**Step 4 — add the images (one per product, through the app).**
1. Open **Products**, search `DEMO`, open a DEMO product.
2. Use the image upload on that product and choose the matching file from `docs/demo-products/images`
   (for example `demo-hammer.png` for DEMO-HAMMER). The image is stored in the app's private image
   storage under the product's own folder. Existing product images are not touched.
3. Repeat for the other nine. The table is: PVC pipe → `demo-pvc-pipe.png`, PVC elbow →
   `demo-pvc-elbow.png`, LED bulb → `demo-led-bulb.png`, electrical cable → `demo-electrical-cable.png`,
   cement bag → `demo-cement-bag.png`, hammer → `demo-hammer.png`, adjustable wrench →
   `demo-adjustable-wrench.png`, measuring tape → `demo-measuring-tape.png`, bolt and nut →
   `demo-bolt-and-nut.png`, plastic bucket → `demo-plastic-bucket.png`.

**Step 5 — verify (read-only).** Run `demo_products_verify.sql` again. Expected:
- `DEMO products found` = `10`
- `duplicate DEMO SKUs` = `0`
- `stock rows on DEMO products` = `0`
- `DEMO products with an image` = `10`
- `TOTAL products` = the number before the import plus 10
- `TOTAL stock_levels rows` and `TOTAL stock_movements rows` and `TOTAL sales rows` = the same as
  in Step 1.

## Repeating or removing

- **Repeat the import:** the same file again only updates the same ten DEMO products. It never
  creates duplicates and never clears their images.
- **Remove the demo:** in **Products**, archive each DEMO product (archiving hides it and keeps the
  history). Hard deletion is not offered, on purpose, so the audit trail is kept.

## What this must never do

It must not change any real product, stock quantity, sale, supplier or purchase record. If any check
in Step 5 differs in those totals, stop and send me the table.
