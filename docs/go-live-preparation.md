# Go-live preparation: preflight, staging, settings, Android install

Status: **preparation only.** Nothing has been run against the live Supabase project, merged, or
deployed. Each production step needs your explicit approval first.

Placeholders (replace them yourself; never paste a key into chat or into the repository):
`<SUPABASE_URL>` = `https://<project-ref>.supabase.co`, `<ANON_KEY>` = the **publishable** key,
`<OWNER>` = your GitHub user or organisation.

---

## A. Read-only POS preflight (`supabase/checks/pos_fix_preflight.sql`)

**What it does:** runs only `SELECT` statements. It changes nothing and locks nothing. It reports
whether the POS objects exist, whether the old constraint is in place, whether anyone can run the
function directly, the POS version marker, and row counts for the main tables.

**Steps (you do these):**
1. Open your Supabase project in the browser, then **SQL Editor** → **New query**.
2. Open the file `supabase/checks/pos_fix_preflight.sql` from the repository (GitHub → Code →
   `supabase/checks/pos_fix_preflight.sql` → Raw, then copy everything).
3. Paste it into the empty query window. Do not change anything.
4. Click **Run**. Wait for the result table (about 18 rows).
5. Copy the whole result table (select all rows → copy) and send it to me. It contains status words
   and counts only. Do not send keys, passwords or connection strings.

**How to read the result:**

| Row | Good value | Meaning if different |
|---|---|---|
| `table public.sales`, `sale_lines`, `sale_payments`, `customers`, `invoice_counters` | `ok` | `MISSING` = POS never applied; the merged POS migration must go first |
| `function …` (three rows) | `ok` | `MISSING` = POS incomplete |
| `sale_lines duplicate … rows` | `ok` | `DUPLICATES - stop`: do not apply anything; send me the output |
| `current state: sale_lines unique constraints` | includes `sale_lines_movement_client_id_key` | if it already shows `sale_lines_org_movement_client_key`, the fix is already in place |
| `current state: authenticated may run app.sale_summary` | `yes (fix will remove it)` | `no (already removed)` = fix already applied |
| `current state: POS version marker` | `none` or a v1 text | mentions `20261124000200` = fix already applied |
| `row count: …` | whatever it is now | write these numbers down; the fix must not change them |
| `row count: suppliers`, `purchase_orders` | `n/a (table not present)` is normal now | not an error |

Nothing in this step is production-changing. Running it again later is harmless.

---

## B. Staging test procedure (before any production merge)

Goal: prove the exact migrations and the web app work end to end, using data that is not yours.

**Staging resources (you create):**
1. A **second Supabase project** named e.g. `hardware-erp-staging`. Free tier is fine. Never use the
   production project for tests that create or change data.
2. A **second GitHub repository** that is a copy (not a fork you push to production from), or a
   private copy with its own Pages site. Its Pages URL is the staging app; the variables point to
   the staging project.

**Procedure:**
1. Apply the migrations to **staging only**, in order: the merged migrations through
   `20261124000100`, then `20261124000200_pos_sales_fix.sql` (or the chain order from the runbook).
   Run the matching `supabase/checks/*_verify.sql` after each.
2. Create two test staff accounts in the staging project (owner and cashier) through the Supabase
   dashboard. Never reuse production accounts.
3. In staging, set the repository variables to the staging project, enable Pages, and deploy the
   branch you want to test (for staging, a copy of the repository on that branch).
4. Run the checks in section D on the staging site, on a real Android phone.
5. Create test data only in staging: a product, a warehouse, a stock receipt, a sale, a supplier.
   Check that the figures match what you expect.
6. Repeat the offline check (airplane mode). Confirm that saves are disabled.
7. Only when every check passes on staging, go back to the approval checklist (section E).

**Do not** run the `workflow_dispatch` of the Pages workflow from a feature branch of the production
repository: it publishes to the production Pages site.

---

## C. GitHub Pages and environment variables (no secrets involved)

Confirmed by reading the workflow (`.github/workflows/deploy-pages.yml`):
- The workflow reads **repository variables** `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Variables are not secret; the anon key is public by design.
- It refuses to build if either is empty, and refuses any `sb_secret_` or `service_role` key
  (`scripts/check-public-key.mjs`). This is a protection, not a substitute for care.
- The base path is set from the repository name: `/hardware-store-erp`.
- A `.nojekyll` file keeps `_next` folders from being hidden.

**Your settings (owner, one time):**
1. GitHub → repository → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab.
   Create (or check) two **variables** (not secrets):
   - `NEXT_PUBLIC_SUPABASE_URL` = `<SUPABASE_URL>`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `<ANON_KEY>` (the publishable key from Supabase **Project
     Settings → API Keys**; use the publishable/anon one, never the secret/service-role one)
2. GitHub → **Settings** → **Pages** → **Build and deployment** → **Source: GitHub Actions**.
3. Supabase → **Authentication** → **URL Configuration**:
   - **Site URL** = `https://<OWNER>.github.io/hardware-store-erp/`
   - **Redirect URLs** → add `https://<OWNER>.github.io/hardware-store-erp/**`

**Never** put a database password, a `service_role` key, or an `sb_secret_` key in variables,
secrets, code, or chat. The deploy guard would refuse it, and the key would be visible to every
visitor in the downloaded JavaScript.

---

## D. Connectivity and site checks

**1. Supabase reachable (on your computer, publishable key only):**
```bash
SUPABASE_URL=<SUPABASE_URL>
ANON_KEY='<ANON_KEY>'           # type it in the terminal; do not write it to a file
curl -s -o /dev/null -w "health %{http_code}\n" "$SUPABASE_URL/auth/v1/health" -H "apikey: $ANON_KEY"
```
Expected: `health 200`. Anything else: stop; send me the code (not the key).

**2. Site and PWA files (replace `<OWNER>`):**
```bash
BASE=https://<OWNER>.github.io/hardware-store-erp
curl -s -o /dev/null -w "site %{http_code}\n" "$BASE/"                  # 200
curl -s -o /dev/null -w "pos %{http_code}\n" "$BASE/pos/"               # 200
curl -s "$BASE/manifest.webmanifest" | grep -o '"name": *"[^"]*"'       # Al Qureshi Hardware ERP Pro
curl -s -o /dev/null -w "sw %{http_code}\n" "$BASE/sw.js"               # 200
```

**3. In the app:** the header shows **Online** after sign-in. Tapping it checks the server again.

---

## E. Android PWA: exact installation steps

Prerequisites: Android phone with Chrome installed and up to date; the HTTPS site address from
section D; a staff account for the site.

1. Open **Chrome** and go to `https://<OWNER>.github.io/hardware-store-erp/`.
2. Sign in. Confirm the header shows **Online** and the Dashboard loads.
3. Install, using either route:
   - **Route 1:** tap the **More** button at the bottom right of the bar, then **Install app** (shown
     when Chrome allows it).
   - **Route 2:** tap Chrome's menu (**⋮**, top right) → **Install app**, or **Add to Home screen**.
   - Confirm the install with **Install**.
4. Find the new icon **Al Qureshi ERP** on the home screen (the short name; launchers truncate the
   full name) and open it. It should open full screen with no browser address bar.
5. Check the app's name in the header reads **Al Qureshi Hardware ERP Pro**.
6. Test offline: turn on airplane mode. The header shows **Offline**, a warning banner appears, and
   Save buttons are disabled. Turn airplane mode off; the badge returns to **Online**.
7. Test the update prompt only on staging, after a second deployment: the banner **A new version is
   ready** appears; the app does not reload until you tap **Update now**.

If the install option is missing: check the URL is `https://` (not `http://`), that Chrome is up to
date, and that you signed in once. Then try again from the menu.

---

## F. Final approval checklist (owner)

Reply with the items you approve. Each production step will then be executed one at a time, with a
check after each.

- [ ] Send me the output of section A from the **live** project (the preflight table only).
- [ ] Confirm you have a recent database backup (Supabase → Database → Backups) and know how to
      restore it.
- [ ] Approve creating a **staging** Supabase project and a staging Pages site (section B). Say
      whether you want me to prepare the staging steps in detail.
- [ ] Confirm the repository variables and Pages source are set (section C).
- [ ] Confirm the Supabase Site URL and Redirect URLs are set (section C).
- [ ] Accept the POS fix on the PR branches #10, #11 and #12 (already pushed for review, not merged).
- [ ] Decide on PR #7: convert as prepared (`20261124000300_dashboard_summary_fix.sql` on
      `claude/fix-dashboard-rpc`), or leave it.
- [ ] Approve the merge order in `docs/deployment-runbook.md` section 4.
- [ ] Approve the database step for each merge (applying a migration changes production).
- [ ] Approve production deployment of the final PWA merge (#13).
- [ ] Confirm each merge deploys the website immediately (it does).

After approval, I will run only the steps you approve, one at a time, and wait for your result
before the next.
