# Mobile, desktop and PWA upgrade: baseline, risks and plan

Branch: `claude/pwa-mobile-upgrade` (created from `claude/phase-4b-purchase-orders`).
Scope: responsive layout, mobile navigation, mobile POS, PWA install and update, connection
indicator. Out of scope: Phase 4C, Phase 4D, APK packaging, database migrations, production deploy.

## 1. Baseline (measured before any change)

Build: production static export with `NEXT_PUBLIC_BASE_PATH=/hardware-store-erp` and a placeholder
Supabase URL (no real project used).

Harness: `tests/e2e/harness.cjs`. It serves the built app and answers Supabase calls from fixed
fixture data (owner role, one fixture branch and one warehouse). It does not contact the real
Supabase project and does not write any business data.

Overflow matrix (`tests/e2e/layout-baseline.cjs`): 8 authenticated pages x 6 widths.

| Width | Before | After |
|---|---|---|
| 320 px | `/dashboard/` overflowed by 44 px | ok |
| all other rows | ok | ok |

Cause found and fixed in `apps/web/src/features/dashboard/dashboard.tsx`: three card grids had no
mobile column count, so the single implicit column sized to its widest content. Added
`grid-cols-1` and `flex-wrap` on the phase-badge row. This is a layout-only change.

Verified that the harness renders the signed-in app (page headings and navigation present), not the
login screen, so the overflow results are for the real screens.

## 2. Risks found during inspection

1. **Existing offline outbox conflicts with the new offline rules.** `SyncEngine` queues stock
   movements in IndexedDB and flushes them automatically every 20 s and on the `online` event.
   The new requirements say: never submit stock movements while offline, and do not replay failed
   writes automatically. The movements already use idempotency keys, so a replay is safe against
   duplicates, but the automatic replay itself is what the requirements forbid. **Decision needed
   (see section 5).** Until decided, the code keeps the current outbox behaviour and does not
   extend it.
2. **Offline data survives sign-out on shared devices.** IndexedDB keeps queued movements and cached
   data after sign-out. On a shared till this exposes data to the next user. Planned fix: clear the
   offline store on sign-out, and refuse to flush the queue for a different user.
3. **Service-worker caching can leak private data.** A service worker that caches responses from
   the Supabase domain could store tokens, business records or another user's data. Rules below
   prevent this.
4. **Mocked-backend tests have limits.** The harness proves layout, navigation, permissions in the
   UI and offline UI state. It cannot prove real Supabase behaviour, real Android Chrome behaviour,
   real device installation, or real RLS results.
5. **iOS has no install prompt.** Safari requires manual "Add to Home Screen". The app will show
   written instructions for iOS and use the `beforeinstallprompt` event only where the browser
   supports it.
6. **GitHub Pages subpath.** The app lives at `/hardware-store-erp/`. Manifest `start_url`, `scope`,
   icon paths and the service-worker scope must all be relative to that subpath, or the install
   and offline shell will break.

## 3. Caching rules (service worker)

Cache:
- hashed `_next/static/*` files (immutable, content-addressed);
- the manifest, icons, the offline page and the app shell HTML needed to open offline.

Never cache:
- any request to the Supabase domain (`*.supabase.co`) or any other origin;
- any request with an `Authorization` header or cookie;
- any response containing business records, tokens or user data;
- any non-GET request.

Navigation requests use network-first, then the cached offline page. The service worker is only
registered in production builds. Updates: a new worker waits; the user chooses "Update now" to call
`skipWaiting`. There is no silent activation of a new version while a sale is in progress.

## 4. Plan (small steps, each committed and tested)

1. Baseline and harness (done): overflow matrix, auth check, dashboard fix.
2. Responsive pass on remaining pages and forms (dialogs, tables to cards on narrow widths, touch
   targets of at least 44 px, RTL check in Arabic).
3. Mobile bottom navigation (Dashboard, Products, Inventory, POS, More), permission-filtered, with
   safe-area padding and an active indicator. The desktop collapsible sidebar stays as it is.
4. Android back button: history state so that back closes an open sheet first, then navigates.
5. Connection indicator (Online / Offline / Reconnecting) using a health check on the Supabase auth
   health endpoint, plus a revalidation before checkout. Server-dependent write buttons are disabled
   while offline.
6. Mobile POS layout and barcode input (keyboard wedge, manual entry). Totals stay server-calculated
   and checkout stays idempotent. No camera scanning unless the user taps a camera button.
7. PWA: manifest with relative `start_url` and `scope`, 192/512 and maskable icons, apple touch
   icon, production-only service-worker registration, offline page, install guidance, safe update
   flow.
8. Unit tests for pure logic (connection state, cache-rule matcher, manifest validity, navigation
   permission builder) and harness tests for the layout, navigation, permissions and offline UI.

## 5. Decisions needed from the owner

- **Outbox:** (a) keep automatic flushing of queued stock movements when back online, or (b) switch to
  manual "Send queued changes" that the user presses, and never send while offline. Recommendation: (b).
- **Sign-out:** clear the offline store on sign-out (recommended), accepting that unsent queued
  changes are lost unless they are shown to the user first.

## 6. Not tested in this environment

- Real Android Chrome, real iOS Safari, and installed PWA behaviour on devices.
- Real Supabase project data, RLS results and the production database.
- The GitHub Pages deployment (no deploy performed).

## 7. How to run the harness

```
pnpm --filter @erp/web build        # with the placeholder env values shown in section 1
cd apps/web/out && python3 -m http.server 4173   # serve under a copy at /hardware-store-erp/
node tests/e2e/layout-baseline.cjs
```
