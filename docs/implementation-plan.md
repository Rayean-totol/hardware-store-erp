# Implementation plan

Each phase ships working, tested software and does not start before the previous phase's tests
pass. The order follows dependencies: posting needs accounts, accounts need documents, and so on.
Regulatory risk also shapes the order, because ZATCA must be validated before any production POS
go-live.

| # | Phase | Contents | Depends on | Status |
| --- | --- | --- | --- | --- |
| 1 | **Foundation and catalog** | Monorepo, architecture docs, migrations, Auth/RLS, roles and permissions, audit log, shared UI system, i18n (en/ar/bn, RTL), product management (categories, brands, units, multi-unit products, barcodes, prices), seed data, tests, setup guide | — | **Done** (merged) |
| 2 | Inventory and offline sync | Warehouses, immutable stock ledger, moving-average cost, stock in/out/adjustments, low-stock alerts, price tiers, product images, barcode labels, CSV import/export, IndexedDB outbox with idempotent server sync | 1 | **Implemented on branch `claude/phase-2-inventory`** (PostgREST suite not yet run; see below) |
| 3 | Accounting core | Chart of accounts, fiscal periods, journals with balance enforcement, posting-rule engine, trial balance | 1 | Planned |
| 4 | Suppliers and purchasing | Suppliers, POs, goods receipts → stock and journals, supplier invoices/AP, returns, payments | 2, 3 | Planned |
| 5 | Customers and POS | Customers, AR, cash sessions, offline POS sales/returns, tenders, receipts, per-device numbering | 2, 3 | Planned |
| 6 | ZATCA Phase 2 (Integration) | UBL 2.1 invoice generation, hashing/PIH chain, XAdES signing, TLV QR, CSID onboarding, clearance/reporting via Edge Function, retry queue; validated with ZATCA SDK and sandbox, then simulation | 5 | Planned. **Required before production POS use** |
| 7 | Native shells and hardware | Capacitor Android (SQLite, scanner, Bluetooth/USB ESC/POS printing, secure key storage), Tauri Windows (SQLite, USB printers, cash drawer, DPAPI key storage), auto-update | 2, 5, 6 | Planned |
| 8 | Reporting and hardening | Sales/stock/VAT reports, dashboards, data export, backup/restore drills, load tests, security review, accessibility audit | all | Planned |

## Phase 1 scope (delivered)

1. Repository structure with a pnpm workspace, strict TypeScript, ESLint and Prettier.
2. Documentation: architecture, security model, offline-sync design, ZATCA design, ADRs, setup guide.
3. Database migrations:
   * `foundation`: extensions, `app` schema, shared trigger functions (`touch_row`), organizations, branches, profiles
   * `rbac`: permissions, system roles, role matrix, memberships, branch assignments, RLS helpers, org bootstrap RPCs
   * `audit`: append-only audit log and generic audit trigger
   * `catalog`: units, categories, brands, products, product units, invariants, RLS, `save_product` RPC
4. Auth: Supabase email/password sign-in, session handling, organization onboarding, adding team members by email
5. Shared UI system: shadcn/ui-style primitives with Tailwind v4 tokens, dark mode, RTL-safe, bundled fonts
6. Product management module: list/search/filter, create/edit with multi-unit grid, barcode validation/generation, archive/restore, categories and brands
7. Tests: domain unit tests, i18n parity, UI component tests, DB/RLS tests on real Postgres, API tests through real PostgREST
8. Seed data (demo catalog of a hardware store) and a demo-user script

### Known Phase 1 limitations (honest list)

* No offline mode yet. The schema is ready for it (UUIDs, `row_version`, idempotent RPCs), but there is no local store or outbox.
* No stock, sales, purchasing or accounting.
* No ZATCA functionality. Only seller identifiers are stored and their format is checked.
* Custom roles are not editable. Only the system roles exist.
* Auth flows (sign-up, password reset e-mails) rely on Supabase Auth and were not tested end-to-end in this repository's CI, because that needs the Docker-based Supabase stack.
* Capacitor and Tauri projects are not scaffolded yet. The web app is built as a static export so they can wrap it in Phase 7.

## Phase 2 scope (implemented)

Migrations (additive; Phase 1 migrations unchanged):

* `20261121000100_warehouses` — inventory permissions, `allow_negative_stock`, warehouses with a default per branch
* `20261121000200_stock_ledger` — `stock_movements` (append-only), `stock_levels` (projection)
* `20261121000300_stock_rpc` — `apply_stock_movements` (idempotent batch), read functions
* `20261121000400_prices_media_search` — price tiers, `resolve_sale_price`, product image paths and storage policies, brand search

Packages: domain stock/pricing/CSV/import rules; data-layer repositories, IndexedDB outbox and sync
engine; web screens for stock, movements, warehouses, labels, product import and image/tier editing.

### Verified in this environment

| Check | Result |
| --- | --- |
| Lint, typecheck | pass |
| Unit tests (domain 63, data 48, web 33, i18n 15, ui 4) | pass |
| Database tests on PostgreSQL 16 (82, incl. RLS, idempotency, partial batches, audit, storage policies) | pass |
| Static production build (16 routes) | pass |
| Headless browser smoke test of the built pages (configuration screen, no overflow at 390 px) | pass |

### Not verified (be explicit)

* **PostgREST API suite** (`tests/db/src/api/inventory-offline.test.ts`): written, not run. The
  PostgREST binary could not be executed here (blocked by a safety check; the download exists but was
  not run).
* **Supabase Auth, real Storage service, and any signed-in browser flow** (scan → queue → sync against a
  live project). The storage policies are tested only against a shim.
* **Camera barcode scanning** is not implemented (keyboard-wedge scanners work).
* **Background sync** when the app is closed is not implemented (Phase 7 / PWA).

### Known limitations
See [offline-sync.md](./offline-sync.md#limits-honest-list) and [inventory.md](./inventory.md#not-in-phase-2).
