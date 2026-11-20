# Setup guide

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22+ | everything |
| pnpm | 10+ (`corepack enable`) | workspace |
| Supabase CLI + Docker | latest | running the full stack locally (Auth, API, Studio) |
| PostgreSQL client (`psql`) | 15+ | optional: running DB tests without Docker |

## 1. Install

```bash
git clone <repo> && cd hardware-store-erp
corepack enable
pnpm install
```

## 2. Database

### Option A — local Supabase (recommended for development)

```bash
supabase start          # starts Postgres, Auth, PostgREST, Studio in Docker
supabase db reset       # applies supabase/migrations/* then supabase/seed.sql
```

`supabase start` prints the **API URL** and the **anon key**. You need both in step 3.

> `supabase/config.toml` is intentionally minimal and was not run in the environment where
> Phase 1 was built (no Docker there). If the CLI complains about a key, regenerate it with
> `supabase init` and keep the `[db.seed]` and `[auth]` settings.

### Option B — hosted Supabase project

```bash
supabase link --project-ref <ref>
supabase db push        # applies migrations; seed.sql is NOT applied to remote projects
```

Do not load the demo seed into a production project.

## 3. Configure the web app

```bash
cp apps/web/.env.example apps/web/.env.local
# set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
```

If either value is missing, the app shows a **Configuration required** screen instead of starting.

## 4. Demo users (optional, local only)

The seed creates a demo organization and catalog but **no users**, because users must be created
through Supabase Auth. Create them with the Auth admin API:

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase start`> \
DEMO_PASSWORD='choose-a-password' \
pnpm --filter @erp/scripts demo-users
```

This creates `owner@demo.local`, `manager@demo.local` (Riyadh branch only),
`storekeeper@demo.local`, `cashier@demo.local` and `auditor@demo.local`, and attaches them
to the demo organization.

> Status: this script was **not executed** while building Phase 1, because no Supabase Auth
> server was available. Report problems as bugs.

Alternatively, sign up in the app and create your own organization on the onboarding screen.

## 5. Run

```bash
pnpm dev                # http://localhost:3000
pnpm build              # static export into apps/web/out
```

## 6. Tests

| Command | Needs | What it covers |
| --- | --- | --- |
| `pnpm test` | nothing | domain rules, i18n catalogs, data-layer mapping, UI components |
| `pnpm test:db` | PostgreSQL 15+ (superuser) | migrations, constraints, RLS, RPCs, audit log, permission-matrix drift |
| `pnpm test:api` | the above + PostgREST binary | `@erp/data` repositories through real PostgREST with signed JWTs |
| `pnpm lint` / `pnpm typecheck` | nothing | ESLint, TypeScript |

Database tests create (and drop) a database called `erp_test`. They apply
`supabase/tests/supabase-shim.sql` first. The shim provides the `auth` schema and API roles
that Supabase normally provides, and it is **test-only**.

```bash
# any Postgres 15+ works, e.g. `supabase start` exposes one on 54322
export TEST_PG_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
pnpm test:db

scripts/fetch-postgrest.sh   # downloads a pinned PostgREST into .tools/ and verifies its SHA-256
pnpm test:api
```

Tests fail loudly if the database or PostgREST is unreachable. They are never silently skipped.

### Manually resetting a plain-Postgres dev database

```bash
scripts/reset-local-db.sh postgres://postgres:postgres@localhost:5432/postgres erp_dev --seed
```

## 7. Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Configuration required" screen | `.env.local` missing or invalid; rebuild after changes (values are inlined at build time) |
| Everything is empty after sign-in | The user has no membership. Use onboarding, or ask an owner to add your e-mail on the Team page |
| `forbidden` when saving prices | The role lacks `catalog.price_write` (storekeeper). This is expected |
| `concurrency_conflict` | Someone saved the product after you opened it. Reload |
