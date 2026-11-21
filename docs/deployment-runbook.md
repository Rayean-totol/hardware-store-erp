# Deployment runbook: Hardware ERP Pro (web + mobile PWA)

Status: **prepared, not executed.** Nothing has been merged, deployed or run against the live
Supabase project. Each step below waits for your approval.

Placeholders used below (replace them yourself; never paste keys into chat or into the repository):
- `<SUPABASE_URL>` is your project URL (`https://<project-ref>.supabase.co`).
- `<ANON_KEY>` is the **publishable** key. Never the service-role key.
- `<OWNER>` is your GitHub user or organisation name.

---

## 1. Review results (summary)

| PR | Branch → base | Status | Blocking issues |
|---|---|---|---|
| #10 | `fix-pos-menu-visibility` → `main` | open | Edits the merged POS migration in place. Fixed in the forward migration (section 2). |
| #11 | `phase-4a-suppliers` → `main` | open | Same in-place POS edit; adds suppliers migration. Fixed by the same forward migration. |
| #12 | `phase-4b-purchase-orders` → `phase-4a-suppliers` | open | Needs retargeting to `main` after #11. Adds purchase-order migration. |
| #13 | `pwa-mobile-upgrade` → `phase-4b-purchase-orders` | open | Contains everything above plus the PWA. Needs retargeting to `main` last. |
| #7 | `fix-dashboard-rpc` → `phase-1-premium-dashboard` (merged long ago) | open | **Edits an applied migration in place** (`20261123000100_dashboard_summary.sql`). Must become a forward migration before merge (section 3). Its base is old; it must be retargeted to `main`. |

Merge conflicts: none textually. Both simulated merge orders (with and without #7 first) were clean.
Full local suites passed on the merged result (section 5).

---

## 2. The POS fix (`20261124000200_pos_sales_fix.sql`)

On branch `claude/pwa-mobile-upgrade`, commit `d1d9aab`. Contents:
- `20261124000100_pos_sales.sql` restored to its merged (`main`) form;
- `20261124000200_pos_sales_fix.sql`: a new forward migration with the same changes, idempotent,
  with a preflight that refuses to run if prerequisites are missing;
- `supabase/checks/pos_fix_preflight.sql` and `supabase/checks/pos_fix_verify.sql`: **read-only**;
- an upgrade test (`tests/db/src/migrations/pos-fix-upgrade.test.ts`) and a pinned checksum.

It applies cleanly on top of #10 and #11 branches as well (only the manifest test conflicts, which
is resolved by taking the fix's version; the derived-pending manifest makes that stable).

**Not applied to any database.** To use it on #10 and #11, the same commit must be added to those
branches. That push is waiting for your approval.

### Database preflight (read-only, run first, on the live project)
Open Supabase → SQL editor → paste `supabase/checks/pos_fix_preflight.sql` → run. It only reads.
Send back the output (it contains counts and status words, no keys).

Decision table:
| Preflight result | Meaning | Next step |
|---|---|---|
| `table public.sales` = MISSING | POS was never applied | apply `20261124000100_pos_sales.sql` from `main` **first**, then the fix |
| all `ok`, version marker `none` or a v1 comment | merged POS applied | apply the fix only |
| all `ok`, version marker mentions `20261124000200` or v2 | fix already applied by hand | nothing to do; run the verify script |
| `DUPLICATES - stop` | data breaks the new key (cannot normally happen) | stop and send me the output |

### Applying (only after backup and approval)
1. Backup: Supabase dashboard → Database → Backups; confirm a recent backup exists.
2. Run `pos_fix_preflight.sql` again immediately before applying (state can change).
3. Paste `20261124000200_pos_sales_fix.sql` into the SQL editor, run it once.
   It creates no tables, deletes no rows, and changes only one constraint and three functions.
4. Run `pos_fix_verify.sql`. Every check must read `ok`. The row counts must equal the preflight
   counts.

If step 3 fails, nothing is changed (the migration stops before any change, or the whole statement
rolls back). Send me the error text. Do not retry blindly.

---

## 3. PR #7 (dashboard RPC) — required change before merge

PR #7 edits `20261123000100_dashboard_summary.sql` in place. The new manifest test pins that
file's `main` version, so #7 as written fails the test by design. Required:
- restore the file to its merged version;
- add a forward migration (for example `20261123000200_dashboard_summary_fix.sql`) with the same
  function body. It drops and recreates a **read-only** function, so it is safe to run.
- Confirm on live first what the dashboard function currently is:
  `select pg_get_function_arguments('public.dashboard_inventory_summary(uuid,uuid)'::regprocedure);`
  (no error = function exists; an error = missing, which the fix creates.)

I can prepare this on your approval. #7 is not required for the POS or PWA merges, but it fixes the
dashboard error you reported earlier, so it should be merged early (step 3b below).

---

## 4. Merge order

Every merge into `main` **deploys the website immediately** (`.github/workflows/deploy-pages.yml`).
So each database step must be finished before the merge that needs it.

1. **Approve** the fix commit being added to #10 and #11 (section 2).
2. **Database: POS.** Preflight → (apply v1 only if MISSING) → apply fix → verify. (Section 2.)
3. **Merge #10** into `main`. Deploys (diagnostics and tests; no new UI).
   - 3b. Then, if approved: convert #7 to a forward migration, apply it after preflight, merge #7.
4. **Database: suppliers.** Apply `20261125000100_suppliers.sql`. Run `supabase/checks/phase4a_suppliers_verify.sql`
   (read-only). Expect `ok` everywhere.
5. **Merge #11**. Deploys the supplier screens. Needs step 4 done first.
6. **Retarget #12** to `main`. Then **database: purchasing.** Apply
   `20261126000100_purchase_orders.sql`. Run `supabase/checks/phase4b_purchase_verify.sql`.
7. **Merge #12**. Deploys purchasing screens.
8. **Retarget #13** to `main`. No database change. Test on a staging deployment (section 6 step 1),
   then **merge #13**. This deploys the mobile + PWA app.

Each step waits for your go-ahead. Stop at any failed check.

---

## 5. Local test results on the final branch

Run on `claude/pwa-mobile-upgrade` at commit `d1d9aab`.

| Check | Result |
|---|---|
| Lint | pass |
| Typecheck (all packages) | pass |
| Unit, all packages (web 121, domain 128, data 80, i18n 15, ui 4) | pass |
| Database suites, including the two new POS upgrade tests (259 + 9 concurrency) | pass |
| API suites (14 + 7) | pass |
| Production build (`/hardware-store-erp/` base path) | pass |
| Browser end-to-end (17 scenarios, including PWA update, offline, legacy data) | 17 of 17 pass |

Migration tests (12, including the POS upgrade and guard tests) also pass on the #10 and #11 branches with the fix applied.

---

## 6. Deploying the mobile + PWA application

### 6.1 Staging first (recommended, can be a second GitHub Pages site or a local build)
Use a **separate Supabase staging project** for any test that changes data. Never create test
sales or stock in production.

### 6.2 GitHub settings (owner, once)
1. Repository → Settings → Secrets and variables → Actions → **Variables** (not Secrets):
   - `NEXT_PUBLIC_SUPABASE_URL` = `<SUPABASE_URL>`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `<ANON_KEY>` (publishable key only)
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. The workflow sets the base path from the repository name (`/hardware-store-erp`) automatically.

### 6.3 Supabase settings (owner, once)
Supabase → Authentication → URL Configuration:
- **Site URL:** `https://<OWNER>.github.io/hardware-store-erp/`
- **Redirect URLs:** add `https://<OWNER>.github.io/hardware-store-erp/**`

Without this, sign-in fails with an "invalid path" error.

### 6.4 Deploy (after the merge in section 4 step 8)
1. Actions tab → "Deploy web app to GitHub Pages" → wait for the green check.
2. If it fails, the log names the missing variable. Fix it and re-run the workflow. Nothing else is
   changed.

### 6.5 Verify the deployed site (from your computer)
Replace `<OWNER>`:
```bash
BASE=https://<OWNER>.github.io/hardware-store-erp
curl -s -o /dev/null -w "site %{http_code}\n" "$BASE/"
curl -s -o /dev/null -w "pos page %{http_code}\n" "$BASE/pos/"          # 200 (refresh on a sub-page works)
curl -s "$BASE/manifest.webmanifest" | grep -o '"name": *"[^"]*"'         # Al Qureshi Hardware ERP Pro
curl -s -o /dev/null -w "sw %{http_code}\n" "$BASE/sw.js"                 # 200
for f in icons/icon-192.png icons/icon-512.png icons/icon-maskable-512.png icons/apple-touch-icon.png; do
  curl -s -o /dev/null -w "$f %{http_code}\n" "$BASE/$f"                  # 200 each
done
```

### 6.6 Supabase connectivity (from your computer; uses only the publishable key)
```bash
SUPABASE_URL=https://<project-ref>.supabase.co
ANON_KEY='<ANON_KEY>'                       # paste locally; do not save it in a file in the repo
curl -s -o /dev/null -w "health %{http_code}\n" "$SUPABASE_URL/auth/v1/health" -H "apikey: $ANON_KEY"
# expect: health 200
```
In the app: the header badge reads **Online** after the server check. Tapping it checks again.

---

## 7. Install the PWA on your Android phone

Prerequisites: Chrome on Android, the deployed HTTPS address from 6.5, and a staff account.

1. Open `https://<OWNER>.github.io/hardware-store-erp/` in Chrome.
2. Sign in. The header should say **Online**. The Dashboard should load figures.
3. Install, either way:
   - Tap **More** (bottom bar) → **Install app** (shown when Chrome allows the install), or
   - Chrome menu (⋮) → **Install app** / **Add to Home screen**.
4. Open the installed app from the home screen. It should open full screen (no browser address bar)
   with the name **Al Qureshi Hardware ERP Pro**.
5. Turn on airplane mode in the installed app: the header shows **Offline**, the banner appears, and
   Save buttons are disabled. Turn airplane mode off: the badge returns to **Online**.

Expected limits: pages you never opened while online cannot open offline; a full reload offline
shows an offline page. These are by design.

For an iPhone (for reference): Safari → Share → **Add to Home Screen**. The More sheet shows these
instructions.

---

## 8. Updates after the first install
When a new version is deployed, a prompt **"A new version is ready"** appears. The app does not
reload by itself. Finish what you are doing, then tap **Update now**.

---

## 9. Rollback
- **Website:** revert the merge commit on `main`; the Pages workflow redeploys the previous build.
- **Database:** migrations are forward-only. Restore from the backup taken in section 2, step 1 if
  an applied migration must be undone. Do not edit applied migration files.

---

## 10. Final approval checklist (owner)

Tick each item and reply with the ones you approve. I will not proceed on any item until you do.

- [ ] I approve adding the POS fix commit (`d1d9aab`) to the #10 and #11 branches, so the chain is
      consistent.
- [ ] I approve converting PR #7 to a forward migration (section 3). Or: I want #7 left unmerged.
- [ ] I approve the merge order in section 4.
- [ ] I have sent the output of `pos_fix_preflight.sql` from the live project (no keys needed).
- [ ] I have a recent database backup and know how to restore it.
- [ ] The GitHub repository variables and Pages source are set (section 6.2).
- [ ] The Supabase URL configuration includes the Pages address (section 6.3).
- [ ] I want a staging test first (section 6.1) before the final merge.
- [ ] I understand each merge deploys the website immediately.

Only after these: I will run the steps in the order above, one at a time, waiting for your result
after each.
