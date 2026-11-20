# Architecture

Hardware Store ERP & POS for Saudi Arabia: an offline-first, multi-branch, multilingual
(English, Arabic RTL, Bangla) system that runs as a web app, an Android app (Capacitor) and a
Windows desktop app (Tauri), all from one TypeScript codebase.

> Status: **Phase 1 (foundation and product catalog)** is implemented. Everything else in this
> document is design only, and each section says so. See [implementation-plan.md](./implementation-plan.md).

---

## 1. Goals and non-goals

| Goals | Non-goals (for now) |
| --- | --- |
| The POS keeps selling while the internet is down. Inventory and accounting stay correct after re-sync. | Being a general-purpose ERP (HR, payroll, manufacturing). |
| Every financial effect is a balanced double-entry journal and can be traced back to its source document. | Multi-currency trading. SAR is the functional currency; foreign currency is out of scope until there is a real need. |
| ZATCA e-invoicing (Phase 2, "Integration") built to the published specs and **validated** with ZATCA's SDK and sandbox before anyone calls it compliant. | Claiming compliance without validation. |
| Branch isolation and per-role permissions, enforced in the database (RLS), not only in the UI. | Trusting the client for authorization. |
| Every master-data and financial change is audit-logged, append-only. | |

## 2. System context

```
┌──────────────────────────── Clients (one codebase: apps/web) ────────────────────────────┐
│  Browser (PWA)        Android tablet/phone (Capacitor)        Windows PC (Tauri)          │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐    │
│  │ React UI (shadcn/ui, Tailwind, RTL)  ─ i18n (en / ar / bn)                        │    │
│  │ Feature modules (catalog, inventory, pos, purchasing, accounting …)              │    │
│  │ @erp/domain  ← pure business rules, shared with server-side code and tests       │    │
│  │ @erp/data    ← repositories: Supabase (online) | local store (offline, Phase 2)  │    │
│  │ Sync engine (Phase 2): outbox of idempotent commands + pull by row_version        │    │
│  │ Device services (Phase 7): receipt printer, cash drawer, scanner, ZATCA signing   │    │
│  └──────────────────────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────┬──────────────────────────────────────────────┘
                                            │ HTTPS (PostgREST / RPC, Auth, Realtime)
┌───────────────────────────────────────────▼──────────────────────────────────────────────┐
│ Supabase                                                                                   │
│  Auth (GoTrue) ─ JWT ─► PostgREST ─► PostgreSQL                                            │
│                                     • RLS on every tenant table                            │
│                                     • RPCs for multi-row business transactions             │
│                                     • triggers: audit log, row_version, invariants         │
│  Edge Functions (Phase 6): ZATCA clearance/reporting gateway, CSID onboarding              │
└───────────────────────────────────────────┬──────────────────────────────────────────────┘
                                            │ mTLS-free HTTPS with CSID credentials
                                  ZATCA FATOORA platform (sandbox → simulation → production)
```

### Why this stack

* **Next.js static export** (`output: 'export'`). Capacitor and Tauri both load a folder of static
  files, so the app must not depend on a Node server at runtime. All data access is client-side
  through `@erp/data`. Server-only logic lives in Postgres (RLS, RPCs, triggers) and in Supabase
  Edge Functions where secrets are needed (ZATCA credentials). Dynamic routes use query strings
  (`/products/edit?id=…`) because static export cannot pre-render unknown IDs.
* **Business rules in `@erp/domain`** (pure TypeScript, no I/O). The same functions run in the
  browser, in the offline sync engine and in tests. Rules that guard data integrity are
  **also** enforced in Postgres (constraints, triggers, RPC checks), because the database is the
  last line of defence and clients cannot be trusted.
* **Decimal arithmetic** via `decimal.js` for every quantity and amount. JavaScript floats are
  never used for money (`0.1 + 0.2 !== 0.3`). Postgres stores `numeric`.

## 3. Repository layout

```
apps/
  web/            Next.js app (static export) used by browser, Capacitor and Tauri
  mobile/         Capacitor shell (planned, Phase 7). README only
  desktop/        Tauri shell (planned, Phase 7). README only
packages/
  domain/         Pure business logic: decimal, VAT, units, barcodes, product rules, permissions, Saudi identifiers
  i18n/           Messages (en, ar, bn), locale metadata (dir, Intl locale, numbering system), formatters
  ui/             Shared shadcn/ui-style components + Tailwind theme tokens (RTL-safe)
  data/           Data-access layer: typed rows, repositories, error mapping, Supabase client factory
supabase/
  migrations/     Ordered SQL migrations (the only way the schema changes)
  seed.sql        Demo catalog data for local development (no users; see scripts/)
  tests/          Supabase compatibility shim used when testing on plain Postgres
tests/db/         Database (SQL + RLS) and API (PostgREST) integration tests
scripts/          Dev tooling (local test DB, PostgREST download, demo users)
docs/             Architecture, ADRs, setup, module specs
```

## 4. Multi-tenancy, branches and security

### Tenancy model

* `organizations` is the tenant (one VAT-registered business). Every business table has
  `org_id`, and composite foreign keys `(child.parent_id, child.org_id) → parent(id, org_id)`
  make cross-tenant references impossible even for buggy RPCs.
* `branches` belong to an organization. Master data (products, units, customers, suppliers) is
  **organization-wide**. Transactional data (stock movements, sales, purchases, cash sessions) is
  **branch-scoped** (Phase 2 onwards).
* `memberships(org_id, user_id, role_id, all_branches)` + `membership_branches` decide which
  organizations and branches a user can access.

### Roles and permissions

Permissions are fine-grained codes (`catalog.write`, `catalog.price.write`, `audit.read`, …). Roles
are bundles of permissions. Phase 1 ships **system roles** only: owner, admin, manager,
storekeeper, cashier, accountant, auditor. Org-defined custom roles come later.
The matrix lives in `packages/domain/src/permissions.ts` **and** in the migration seed. A database
test fails if the two drift apart.

### Enforcement layers

| Layer | Purpose | Trusted? |
| --- | --- | --- |
| UI hides actions the user lacks | UX only | No |
| `@erp/domain` validation | Fast feedback, offline validation | No |
| RPC checks (`save_product` etc.) | Multi-row invariants, field-level permissions such as price changes | Yes |
| RLS policies + constraints + triggers | Final authority. Every table has RLS enabled | Yes |

RLS helper functions (`app.is_org_member`, `app.has_permission`, `app.can_access_branch`) are
`SECURITY DEFINER` with an empty `search_path`, live in the non-exposed `app` schema and are
granted only to `authenticated`.

See [security.md](./security.md) for the full policy catalogue.

## 5. Audit logging

* A generic trigger `app.audit_row_change()` writes `INSERT`/`UPDATE`/`DELETE` events into
  `audit_log` with old/new row images, changed fields, the actor (`auth.uid()`), the DB role,
  transaction id and the optional `x-device-id` request header (offline devices).
* `audit_log` is **append-only**: no table privileges for `anon`/`authenticated`, and a trigger
  rejects `UPDATE`/`DELETE` for every role, including `service_role`. Reading requires `audit.read`.
* Financial documents (Phase 3 onwards) are never edited after posting; corrections are reversing
  entries or credit/debit notes. The audit log is evidence, not the mechanism of correction.

## 6. Domain modules

### 6.1 Catalog and unit conversion — **implemented (Phase 1)**

* `units`: system units (pcs, box, m, cm, kg, l, …) plus org-specific units. Each unit has a
  *dimension* (count, length, mass, volume, area). It also has an optional `ratio_to_dimension_base`
  (cm = 0.01 m), so standard conversions can be suggested automatically.
* `products`: SKU (unique per org), names in en/ar/bn (Arabic required, because tax invoices must
  be in Arabic), category, brand, type (stock/service), tax category (ZATCA UNCL5305: S, Z, E, O)
  with an exemption reason code required for non-standard categories, and a **base unit**.
* `product_units`: the packaging and selling units of a product, each with
  `factor` = how many base units it contains, an optional barcode (unique per org), a sale price,
  and sale/purchase flags. Invariant: exactly one base row, its factor is 1, and it matches
  `products.base_unit_id`. A deferred constraint trigger enforces this.
* **Stock is always stored in base units.** For example, 3 boxes of 12 screws is stored as
  36 pcs. A cable sold by the roll (50 m) and by the meter has base unit `m`. Quantities are
  validated against the unit's `allow_fraction` and `decimal_places`. You cannot sell 1.5 pcs,
  but you can sell 1.5 m.
* Prices are VAT-inclusive or VAT-exclusive per organization setting (`prices_include_vat`, the
  default for Saudi retail is inclusive). VAT is calculated per line and rounded half-up to
  2 decimals.

### 6.2 Inventory — *design, Phase 2*

* Immutable `stock_movements` ledger (branch, product, qty in base units, unit cost, source
  document). Per-branch `stock_levels` are a projection maintained by triggers.
* Costing: weighted moving average per branch, recomputed on receipts.
* Documents: opening balance, adjustment (with reason), branch transfer (two-step: dispatch,
  receive), stock count.
* Offline: POS devices may sell into negative stock (configurable). Negative balances are
  flagged for review, not blocked, because blocking a sale at the counter while offline is worse
  for the business.

### 6.3 Purchasing and suppliers — *design, Phase 4*

Suppliers (with VAT number), purchase orders, goods receipts (stock in, in the purchase unit
and converted to base), supplier invoices (AP), purchase returns, supplier payments. A three-way
match (PO ↔ GRN ↔ invoice) is a later enhancement.

### 6.4 Customers and POS — *design, Phase 5*

* Customers: walk-in (default) or named; B2B customers with VAT number and address (needed for
  standard tax invoices). Credit limits and receivables for trade customers.
* POS: cash sessions (open/close with counted float), barcode scan resolves `product_units.barcode`
  to product and unit, split tenders (cash, mada/card, bank transfer, credit), returns against the
  original invoice, receipts printed from local data.
* Invoice numbering is per device (EGS unit), so offline devices never collide:
  `{branch}-{device}-{sequence}`.

### 6.5 Accounting — *design, Phase 3*

* Chart of accounts (Saudi SME template), fiscal periods (open/closed), `journal_entries` +
  `journal_lines` (debit/credit, numeric(18,2)). A deferred constraint trigger enforces
  Σdebit = Σcredit per entry. Posted entries are immutable.
* Posting rules turn documents into journals:
  sale → Dr Cash/AR, Cr Revenue, Cr VAT Output; COGS → Dr COGS, Cr Inventory;
  purchase → Dr Inventory, Dr VAT Input, Cr AP.
* VAT return report (output − input per period) feeds the ZATCA VAT return. Filing itself stays
  manual.

### 6.6 ZATCA e-invoicing — *design, Phase 6*

See [zatca.md](./zatca.md). In short, each POS device is a separate EGS unit with its own CSID
and private key. Simplified (B2C) invoices are signed on the device, so this works offline, and
reported within 24 h. Standard (B2B) invoices need online clearance before they are issued.
Phase 1 only stores the seller data that invoices will need (VAT number, CR, Arabic names,
national address) and checks its *format*. **Nothing in this repository is ZATCA-compliant yet.**

## 7. Offline-first design

Phase 1 is online-only, but the schema is already sync-ready:

* **Client-generated UUID primary keys.** A record created offline keeps its ID forever.
* **`row_version`** (incremented by trigger) and `updated_at` on every mutable row, used for
  incremental pull (`where row_version > :cursor`, or `updated_at` plus a tie-breaker) and for
  optimistic concurrency (`save_product` rejects stale versions with `concurrency_conflict`).
* **Mutations are RPCs that take a full document and are idempotent by ID.** The Phase 2 outbox
  replays the same call after reconnecting.
* **No hard deletes of master data.** Products are archived (`archived_at`), so offline devices
  never hold dangling references.

Phase 2 design ([offline-sync.md](./offline-sync.md)): a local store (SQLite through Capacitor
and Tauri plugins, IndexedDB in the browser) behind the same repository interfaces, an outbox of
commands, server-authoritative conflict handling, and per-device document sequences.

## 8. Internationalisation

* `@erp/i18n` holds flat message catalogs for `en`, `ar` and `bn`. A test checks that all
  three have identical keys and placeholders.
* `<html dir>` is switched at runtime, and components use logical CSS properties (`ms-*`, `pe-*`,
  `start-*`, `text-start`) so RTL needs no separate styles.
* Numbers and dates use `Intl`. Each locale has a configurable numbering system. Saudi
  businesses often prefer Latin digits even in Arabic UI (`ar-SA-u-nu-latn`), and the default
  follows that. Bangla uses `bn-BD`.
* Product names are stored per language (`name_en`, `name_ar`, `name_bn`), with fallback to English.
* Fonts are bundled (Noto Sans, Noto Sans Arabic, Noto Sans Bengali through `@fontsource`), so the
  app renders correctly offline.

## 9. Error handling principles

* Database and RPC errors carry machine-readable codes (`product.sku_taken`, `forbidden`,
  `concurrency_conflict`, …). `@erp/data` maps them to typed `DataError`s, and the UI shows the
  translated message. Unknown errors are shown with their raw message, never swallowed.
* Missing configuration (for example, no Supabase URL) renders an explicit configuration-error
  screen. There is no "demo mode" that pretends to work.

## 10. Testing strategy

| Suite | Runs against | Command |
| --- | --- | --- |
| Domain unit tests | Node | `pnpm test` |
| i18n catalog parity | Node | `pnpm test` |
| UI component tests | jsdom + in-memory repository (test double) | `pnpm test` |
| Database tests: constraints, RLS, RPCs, audit, permission matrix | Real PostgreSQL 15+ with a Supabase auth shim | `pnpm test:db` |
| API tests: `@erp/data` repository through PostgREST with signed JWTs | Real PostgREST + PostgreSQL | `pnpm test:api` |
| E2E (Playwright against full Supabase stack) | Planned with `supabase start` (needs Docker) | — |
