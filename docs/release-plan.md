# Release plan: PRs #10–#13, merge order and production checklist

Status: **not merged, not deployed.** Waiting for owner approval.

## 1. Important: a merge to `main` deploys production

`.github/workflows/deploy-pages.yml` runs on every push to `main`. Merging any PR into `main`
builds and publishes the web app to GitHub Pages immediately. The database is not changed by that
workflow. So the database must always be ready before the merge that needs it.

## 2. Review findings

### Merge conflicts
Simulated locally by merging the four heads in order onto `main`, on a scratch branch that was
then deleted (nothing pushed). Result: **no textual conflicts**. Full suites pass on the merged
result: lint, typecheck, unit (348 tests), database (267), API (21).

### Database compatibility: BLOCKER for #10 and #11

PR #9 (already merged) added `supabase/migrations/20261124000100_pos_sales.sql`. PRs #10 and #11
both **edit that merged file in place** (identical edits in both):

- removes `unique` on `sale_lines.movement_client_id` and adds `unique (org_id, movement_client_id)`;
- adds a preflight block, a branch check on replays, an advisory lock, an idempotent cancel;
- changes grants on `app.sale_summary`;
- adds a version comment on `public.sales`.

Why this is a blocker:

1. `create table if not exists` does nothing when the table already exists. A database that applied
   the original file keeps the old constraint, and never gets the new grants or function bodies.
   A fresh database gets the new version. The two end up with different schemas.
2. The migration manifest test (`tests/db/src/migrations/manifest.test.ts`) pins checksums only up
   to `20261122000100`. The POS file is not pinned, so nothing detects the edit.
3. The full database suite builds a fresh database every run, so it passes and cannot show the
   problem on a live database.

**Recommended fix (not applied; needs your approval):**
- restore `20261124000100_pos_sales.sql` byte-for-byte to the merged version;
- add a new forward migration (for example `20261124000200_pos_sales_v2.sql`) that performs the
  same changes with `alter table` / `create or replace function` / `drop constraint if exists`;
- pin the checksum of the restored v1 file in the manifest test;
- add a test that applies v1 and then v2 on one database, and compares the result with a fresh v2.

Before deciding, confirm which version the live database has. Run in the Supabase SQL editor
(read-only): `select obj_description('public.sales'::regclass);` A result that names migration
`20261124000100 (v2 ...)` means the v2 text was already applied by hand.

### Database compatibility: 4A and 4B
- `20261125000100_suppliers.sql` and `20261126000100_purchase_orders.sql` are new files. Their
  tables have RLS enabled. Their definer functions all set `search_path = ''`. The only
  `delete` (purchase order lines) is inside a draft-only path (`purchase.not_draft` guard).
  `drop trigger if exists` statements are idempotent re-creation.
- Both depend on the POS migration and on earlier migrations (preflight blocks check this).
- Neither has been applied to production. Per the owner's standing rule, nothing is run against
  the live project without approval.

### Security review (scope and limits)
Checked by reading and by scripted checks on the new SQL and the verification scripts:
- every definer function has `set search_path = ''`: pass;
- every new table has RLS enabled: pass;
- no `grant` to `anon` on the new objects: pass;
- verification scripts (`supabase/checks/*.sql`) contain no write statements: pass;
- `#13` changes no database file: pass.

Not done: a full line-by-line security audit of the 4A and 4B functions, and a live RLS test
against a real database with separate roles. Recommended before production.

### Regressions
- #13 changes only app code, tests and docs. Its shared-file edits merged cleanly with #10–#12.
- #10 changes the dashboard test; #11 adds supplier permissions in `packages/domain`. No behaviour
  of existing screens was changed by #13 beyond what is described in its PR body.

### Other open PRs (not in this plan)
- **#7** "Fix dashboard RPC" targets the old phase-1 branch and edits the dashboard RPC migration.
  It needs its own review and must not be merged without checking the live function.

## 3. Merge order

Each step only after the previous one is done and verified.

1. **Decide the POS migration fix** (section 2). Update #10 and #11 accordingly.
2. **Merge #10** into `main` (base `main`). Diagnostics, tests and docs. Deploys; no new UI.
3. **Apply database migrations manually** in the Supabase SQL editor, in order, each after its
   preflight: the POS fix (if the live database has v1), then `20261125000100_suppliers.sql`. Run
   the matching read-only verification script after each.
4. **Merge #11** into `main` (base `main`). Deploys the supplier UI. It needs step 3 done first.
5. **Retarget #12** to `main` (its base branch was removed), then **apply** the purchase migration
   (`20261126000100_purchase_orders.sql`) and run `supabase/checks/phase4b_purchase_verify.sql`.
6. **Merge #12** into `main`. Deploys purchasing UI.
7. **Retarget #13** to `main`. Apply no database change. Run the production checklist (section 4)
   on a preview or staging deployment first, then **merge #13**.

## 4. Production deployment checklist

### Before any merge
- [ ] Database backup taken, and point-in-time recovery confirmed for the project.
- [ ] A staging Supabase project exists, and every migration above was applied there first and the
      staging smoke test passed.
- [ ] Owner has approved each merge in writing.

### Repository configuration (owner)
- [ ] Repository variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set.
      The anon value must be the publishable key. **Never a service-role key.**
- [ ] GitHub Pages source is "GitHub Actions".
- [ ] The Supabase project's Auth **Site URL** and **Redirect URLs** include the Pages address
      `https://<owner>.github.io/hardware-store-erp/` (sign-in fails with "Invalid path" otherwise).

### GitHub Pages base path
- [ ] The deploy build sets `NEXT_PUBLIC_BASE_PATH=/hardware-store-erp` (from the repository name).
      Verified locally with the same value: links, icons, manifest and service worker all use
      `/hardware-store-erp/`.
- [ ] Open `https://<owner>.github.io/hardware-store-erp/` (no redirect loop, no 404 on refresh of
      a sub-page such as `/pos/`).
- [ ] `…/manifest.webmanifest` returns 200 and `name` is "Al Qureshi Hardware ERP Pro".
- [ ] `…/sw.js` returns 200 and contains a stamped cache name (not `__BUILD_ID__`).
- [ ] `…/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` return 200.

### Supabase connectivity (run from your own machine; replace the placeholders)
```bash
curl -s -o /dev/null -w "%{http_code}\n" "$SUPABASE_URL/auth/v1/health" -H "apikey: $SUPABASE_ANON_KEY"
# expect 200
```
- [ ] Health check returns 200.
- [ ] Signing in with a real staff account on the deployed page works, and "Online" shows in the
      header.
- [ ] A read-only page (for example Dashboard) loads figures.

### PWA installation
- [ ] Chrome DevTools → Application → Manifest shows no errors; installability check passes.
- [ ] Android Chrome: the install prompt or menu entry appears; the installed app opens standalone
      at the Dashboard.
- [ ] Desktop Chrome/Edge: install works; the window title is the product name.
- [ ] iPhone Safari: More → the "Add to Home Screen" text appears; the home-screen label is
      "Al Qureshi ERP".

### Service worker and updates
- [ ] After the first visit, reloading shows the page controlled by the service worker.
- [ ] Turn off the network: navigating to a page never opened online shows the offline page; a page
      already opened online still moves inside the app.
- [ ] After the next deployment: the "A new version is ready" prompt appears; the app does not
      reload until "Update now" is pressed.

### Behaviour checks (no business data created)
- [ ] With the network off, the header shows "Offline", the banner appears, and Save buttons on
      products, suppliers and movements are disabled.
- [ ] No sale, stock movement or supplier change is created during smoke tests. Use the staging
      project for anything that writes.

### Rollback
- Web app: revert the merge commit on `main`; Pages redeploys the previous build.
- Database: migrations are forward-only. Restore from the backup taken before the change if a
  migration must be undone. Do not edit an applied migration file.

## 5. What was not verified here
- Real Supabase project, real credentials and live RLS (no access, by design).
- Real Android, iOS and desktop installation (manual steps above).
- GitHub Pages deployment itself (nothing was deployed).
