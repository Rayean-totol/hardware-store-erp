# Hardware Store ERP & POS (Saudi Arabia)

An offline-first ERP and point-of-sale system for hardware stores in Saudi Arabia. It covers
multi-branch inventory with unit conversion, purchasing, POS, customers, suppliers,
double-entry accounting, role-based permissions, audit logs and ZATCA e-invoicing. It runs in
the browser, on Android (Capacitor) and on Windows (Tauri), in English, Arabic (RTL) and Bangla.

**Stack:** TypeScript · React 19 · Next.js 16 (static export) · Tailwind CSS v4 · shadcn/ui-style
components · Supabase (PostgreSQL, Auth, PostgREST) · TanStack Query · Vitest

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Foundation, Auth/RLS, roles, audit log, UI system, i18n, **product catalog** | ✅ implemented and tested |
| 2–8 | Inventory and offline sync, accounting, purchasing, POS, ZATCA, native shells, reporting | 📐 designed, not built |

> ⚠️ **ZATCA:** this software is **not** ZATCA-compliant yet. E-invoicing is planned for Phase 6
> and will only be called compliant after validation with ZATCA's SDK, sandbox and simulation
> environments. See [docs/zatca.md](docs/zatca.md). Do not use it for invoicing until then.

## What Phase 1 contains

* **Database** (`supabase/migrations`): organizations, branches, profiles, permissions, system
  roles, memberships with branch assignment, append-only audit log, units of measure,
  categories, brands, products and product units. RLS is on every table. Guarded RPCs:
  `create_organization`, `add_member_by_email`, `list_members`, `get_my_context`,
  `save_product`, `search_products`.
* **Domain logic** (`packages/domain`): decimal money/VAT (15%, line-level rounding), unit
  conversion and validation, GTIN check digits and in-store EAN-13 generation, SKU rules,
  Saudi identifier format checks, the permission matrix, product validation.
* **Data layer** (`packages/data`): typed repositories over supabase-js, precise numerics, and
  errors mapped to stable codes.
* **i18n** (`packages/i18n`): en/ar/bn catalogs with compile-time and test-time parity, RTL,
  locale-aware number/money/date formatting (Latin digits in Arabic by default, Bengali digits
  in Bangla).
* **UI** (`packages/ui`, `apps/web`): accessible shadcn-style components and bundled fonts.
  Screens: sign-in/sign-up, organization onboarding, product list (search by SKU, name or
  barcode, category filter, archive), product editor (multi-unit grid with factor suggestions,
  barcode check and generation, VAT preview, price-permission lock, conflict handling),
  categories and brands, team members.

## Quick start

```bash
corepack enable && pnpm install
supabase start && supabase db reset          # needs Docker; see docs/setup.md for alternatives
cp apps/web/.env.example apps/web/.env.local  # paste URL + anon key from `supabase start`
pnpm dev
```

Full instructions, including demo users and running tests without Docker: **[docs/setup.md](docs/setup.md)**.

## Tests

```bash
pnpm lint && pnpm typecheck
pnpm test        # 79 unit/component tests: domain, i18n, data layer, UI
pnpm test:db     # 42 tests against real PostgreSQL: RLS, RPCs, constraints, audit, drift checks
pnpm test:api    # repositories through real PostgREST (needs scripts/fetch-postgrest.sh)
```

## Documentation

* [Architecture](docs/architecture.md): modules, tenancy, offline design, ZATCA approach
* [Implementation plan](docs/implementation-plan.md): phases and known limitations
* [Security model](docs/security.md): roles, policies, RPCs, gaps
* [Offline sync design](docs/offline-sync.md)
* [ZATCA notes](docs/zatca.md)
* [ADRs](docs/adr)

## Repository layout

```
apps/web          Next.js app (static export → web, Capacitor, Tauri)
apps/mobile       Capacitor shell (planned)
apps/desktop      Tauri shell (planned)
packages/domain   business rules (pure TS)
packages/data     Supabase repositories
packages/i18n     translations and formatting
packages/ui       shared components and design tokens
supabase/         migrations, seed, config, test shim
tests/db          database and API integration tests
scripts/          dev tooling
docs/             architecture and guides
```
