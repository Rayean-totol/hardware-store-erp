# Security model

## Principles

1. **The database is the security boundary.** The browser, Android and Windows apps all hold
   only the public anon key plus the user's JWT. Every table in `public` has RLS enabled. A
   test (`tests/db/src/db/security.test.ts`) fails if any table is created without it.
2. **Least privilege by default.** `anon` has no table privileges at all. RPCs revoke `EXECUTE`
   from `public`/`anon` and grant it to `authenticated` explicitly.
3. **SECURITY DEFINER only where unavoidable**, always with `set search_path = ''`. A test
   enforces this for every definer function in `public` and `app`.
4. **Never trust client-supplied tenant ids.** Policies check `org_id` through membership
   lookups, and composite foreign keys make cross-tenant references impossible.
5. **The service-role key never ships to clients.** Only `scripts/` and future Edge Functions use it.

## Roles (Phase 1 system roles)

| Permission | owner | admin | manager | storekeeper | cashier | accountant | auditor |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| org.manage | ✓ | ✓ | | | | | |
| branch.manage | ✓ | ✓ | | | | | |
| users.manage | ✓ | ✓ | | | | | |
| audit.read | ✓ | ✓ | ✓ | | | ✓ | ✓ |
| catalog.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| catalog.write | ✓ | ✓ | ✓ | ✓ | | | |
| catalog.price_write | ✓ | ✓ | ✓ | | | | |
| catalog.archive | ✓ | ✓ | ✓ | | | | |
| warehouse.manage | ✓ | ✓ | | | | | |
| inventory.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| inventory.move (stock in/out) | ✓ | ✓ | ✓ | ✓ | | | |
| inventory.adjust | ✓ | ✓ | ✓ | | | | |

Extra rules enforced by triggers:

* Only an **owner** can grant or remove the owner role, and the last active owner cannot be
  demoted or removed (`app.guard_owner_membership`).
* **Price changes** (`product_units.sale_price`) need `catalog.price_write`, even through a
  direct table update (`app.guard_price_change`).
* **Archiving** needs `catalog.archive`. Archive-only users cannot change other columns
  (`app.guard_product_archive`).

## Policy catalogue

| Table | select | insert | update | delete |
| --- | --- | --- | --- | --- |
| organizations | member | via `create_organization()` only | `org.manage` | — |
| branches | member | `branch.manage` | `branch.manage` | — |
| profiles | self or same-org | trigger on `auth.users` | self | — |
| permissions | any authenticated | — | — | — |
| roles / role_permissions | system roles or own org | — (Phase 1) | — | — |
| memberships | self or `users.manage` | `users.manage` | `users.manage` | `users.manage` |
| membership_branches | self or `users.manage` | `users.manage` | `users.manage` | `users.manage` |
| audit_log | `audit.read` | trigger only | never (trigger blocks every role) | never |
| units | system or `catalog.read` | `catalog.write` (org units) | `catalog.write` (org units) | — |
| warehouses | `inventory.read` and branch access | `warehouse.manage` and branch access | same | — (deactivate instead) |
| stock_movements | `inventory.read` and branch access | only `apply_stock_movements()` | **never** (trigger blocks every role) | **never** |
| stock_levels | `inventory.read` and branch access | only `apply_stock_movements()` | only `apply_stock_movements()` | — |
| product_prices | `catalog.read` | `catalog.write` **and** `catalog.price_write` (trigger) | same | same |
| storage `product-images` | org member | `catalog.write` for the org in the path | same | same |
| product_categories, brands | `catalog.read` | `catalog.write` | `catalog.write` | — |
| products | `catalog.read` | `catalog.write` | `catalog.write` or `catalog.archive` | — (archive instead) |
| product_units | `catalog.read` | `catalog.write` | `catalog.write` | `catalog.write` |

Branch-scoped access (`app.can_access_branch`) is already modelled and tested. It will guard
the transactional tables from Phase 2 onwards.

## RPCs

| Function | Security | Purpose |
| --- | --- | --- |
| `create_organization` | definer | Bootstrap tenant, first branch, owner membership |
| `add_member_by_email` | definer (checks `users.manage`) | Attach an existing user to an org |
| `list_members` | definer (checks `users.manage`) | Members with e-mail (auth.users is not exposed) |
| `get_my_context` | definer (scoped to `auth.uid()`) | Memberships, permissions, branches |
| `save_product` | invoker (RLS applies) | Atomic product + units save with optimistic locking |
| `search_products` | invoker (RLS applies) | SKU/name/barcode/brand search |
| `save_product_prices` | invoker (RLS and price trigger apply) | Replace price tiers without rewriting unchanged rows |
| `resolve_sale_price` | invoker | Best price for a quantity |
| `apply_stock_movements` | definer (checks membership, then per-item permission and branch access) | The only stock writer; idempotent; item isolation |
| `list_stock_levels`, `list_low_stock`, `list_stock_movements` | invoker (RLS applies) | Stock read models |

## Known gaps and follow-ups

* **Custom roles** are not editable yet. When added, editing a role must not grant permissions
  the editor does not hold.
* **Rate limiting and brute-force protection** rely on Supabase Auth defaults. Review before go-live.
* **MFA** for owner and admin roles is recommended (Supabase Auth supports TOTP). It is not enforced yet.
* **Audit log retention and export** are not designed yet. Note the interaction with
  ZATCA archiving requirements.
* **Data residency (KSA)** for the Supabase project must be decided before production.
* The **service role bypasses RLS.** Any future Edge Function that uses it must re-check permissions itself.
