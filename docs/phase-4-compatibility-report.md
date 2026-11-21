# Phase 4 compatibility report

Status: prepared before Phase 4A changes. Phase 4A starts only after this report is reviewed.
Scope of this report: the full Phase 4 plan, with the detailed design for Phase 4A (suppliers).
Phases 4B–4E are not started and are described only at the level needed to check 4A's design.

## 1. Repository state (inspected)

| Item | Finding |
| --- | --- |
| Base branch | `claude/phase-4a-suppliers` is created from `claude/fix-pos-menu-visibility` (commit `4f42335`). That branch contains the corrected POS migration and is PR #10, not yet merged. |
| Migrations on this base | 12 files, `20261120000100` … `20261124000100`. The newest is the POS migration. |
| Supplier code | None in SQL or `packages/`. Only navigation labels (`nav.suppliers`) and a placeholder nav item in `app-shell.tsx` exist. |
| Stock writer | `public.apply_stock_movements(uuid, text, jsonb)` (security definer, per-item savepoints, idempotent by `client_id`). Only writer of `stock_movements` and `stock_levels`. |
| Ledger | `stock_movements` is append-only (update/delete/truncate refused). `stock_levels` is a projection written only by the stock writer. |
| Audit | `app.audit_row_change(<org column>)` trigger. Writes `audit_log`. Used by catalogue, POS and organisation tables. |
| Optimistic locking | `save_product(jsonb, jsonb, bigint)` pattern: `row_version` compared with the expected version; raises `concurrency_conflict`. |
| RPC grants | Hardening migration: PUBLIC and anon have no execute on `public` or `app` functions. Authenticated has explicit grants. |
| Table grants | Hardening migration: `anon` has no table privileges. `authenticated` has an exact matrix (see `docs/security.md`). |
| Permissions | Catalogue in `permissions` table; system roles in `roles`; grants in `role_permissions`. Mirrored in `packages/domain/src/permissions.ts`; a drift test compares them. |
| Tests guarding the database | `hardening.test.ts` (exact table-privilege matrix; exact list of callable public RPCs); `security.test.ts` (permission catalogue and role matrix equal the domain constants); `manifest.test.ts` (migration order and checksums); `i18n-coverage.test.ts` (every `app.fail('code')` in migrations needs an `errors.<code>` message in en, ar and bn). |
| Next migration number | `20261125000100_suppliers.sql` (ordering after POS). |

## 2. Existing objects Phase 4A depends on (verified in migrations)

| Object | Used for |
| --- | --- |
| `organizations` (`id`, `vat_number`, `prices_include_vat`, `standard_vat_rate`) | Tenant root; VAT conventions |
| `memberships`, `membership_branches`, `roles`, `role_permissions`, `permissions` | Access control |
| `app.is_org_member(uuid)`, `app.has_permission(uuid, text)`, `app.fail(text, text)`, `app.touch_row()`, `app.audit_row_change(text)` | Helpers used by new functions and triggers |
| `audit_log` | Audit trail (via trigger) |

No existing table, column, function, policy or data is changed by Phase 4A.

## 3. Phase 4A design (what the migration will create)

New objects only:

| Object | Kind | Purpose |
| --- | --- | --- |
| `supplier_counters` | table, no API grants | One counter per organisation for auto-generated supplier numbers (`SUP-000001`). Written only by `save_supplier`. |
| `suppliers` | table, no API grants | Supplier master data. Unique `(org_id, supplier_code)`. Partial unique `(org_id, vat_number)` where VAT number is set. Audit trigger. |
| `list_suppliers(org, search, status, limit, offset)` | function, security definer | Directory. Returns financial columns only to `suppliers.manage`. |
| `get_supplier(org, id)` | function, security definer | Profile. Financial columns and bank details only to `suppliers.manage`. |
| `save_supplier(org, jsonb, expected_version)` | function, security definer | Create and update with server-side validation, optimistic locking and uniqueness checks. |
| `suppliers.read`, `suppliers.manage` | permission rows | RBAC (existing table; rows added, none changed). |
| Role grants | `role_permissions` rows | See section 4. |

Existing tables are not altered. Sales, stock, product and POS data are not touched.

Access model: the `suppliers` table has no privileges for `authenticated` or `anon`. All reads and writes go through the three functions, which check organisation membership and permissions. This means no direct table writes from the client, and no way to bypass validation.

## 4. Proposed default access (for review)

| Role | suppliers.read | suppliers.manage |
| --- | :-: | :-: |
| owner | ✓ | ✓ |
| admin | ✓ | ✓ |
| manager | ✓ | ✓ |
| storekeeper | ✓ (no financial fields) | |
| accountant | ✓ (no financial fields in 4A) | |
| auditor | ✓ (no financial fields) | |
| cashier | | |

Financial fields (opening balance, credit limit, bank details) are visible only to `suppliers.manage` in 4A. Phase 4D will add `supplier_payments.read` and show balances to accountants.

## 5. Approval required before implementation

These decisions change behaviour that a reviewer should confirm. The defaults in brackets are what I will implement unless you say otherwise.

1. **VAT registration number unique per organisation** [yes]. Two supplier records with the same VAT number would split one legal entity's history. Partial unique index, so blank numbers are allowed.
2. **Arabic supplier name required** [yes], matching product names. Bangla stays optional.
3. **Supplier code** [optional on input; if blank, the code is set to the supplier number, e.g. `SUP-000001`]. Unique per organisation, case-insensitive, same format as product SKUs.
4. **Opening balance** [payable only, zero or positive, two decimals, editable in 4A]. In Phase 4D, a ledger will exist and the opening balance will be locked once any supplier entry exists. Please confirm you accept editing it in 4A.
5. **Financial fields hidden from storekeeper, accountant and auditor in 4A** [yes]. Accountant access arrives with `supplier_payments.read` in 4D.
6. **IBAN** [Saudi IBAN only, `SA` plus 22 digits]. Foreign suppliers would need a separate decision.
7. **PDF export of the supplier directory is deferred** [CSV export in 4A]. PDF statements and reports arrive in 4D with the ledger, so the supplier directory PDF is not built now. Please confirm.
8. **Supplier history, payment history and balance on the profile** are shown as empty states in 4A and filled in 4C–4D. They are not invented values.
9. **Attachments** (supplier invoices, delivery notes, credit notes) are deferred to 4C, when storage policies for purchase documents are designed. Supplier-level documents such as a VAT certificate are not in 4A.

## 6. Risks and how they are handled

| Risk | Handling |
| --- | --- |
| Duplicate suppliers (same VAT number or code) | Database unique constraints and server checks (`supplier.code_taken`, `supplier.vat_taken`) |
| Cross-organisation access | Every function filters by `org_id` and checks membership; no table grants to clients; tests with an outsider account |
| Permission bypass | Checks inside each function; the frontend only hides controls |
| Concurrent edits | `row_version` check raises `concurrency_conflict` |
| Financial data leakage to read-only roles | Separate column sets returned by the functions; tests for storekeeper, auditor and cashier |
| Breaking POS and stock | No change to those objects; regression suites run in full |
| Migration failure on live project | Preflight block names missing prerequisites; the migration only creates new objects; re-runnable |

## 7. Out of scope for Phase 4A (later phases)

- 4B: purchase orders, purchase order lines, approval workflow, `purchase.*` permissions.
- 4C: goods receipts, purchase invoices, stock-in through the stock writer, purchase VAT, attachments.
- 4D: supplier payments, allocations, ledger entries, statements, overdue reports.
- 4E: purchase returns, credit notes, reversals, deployment verification.

No ZATCA compliance is claimed. VAT data for purchases will be recorded in 4C with the tax category and amount on each line, for the future VAT / ZATCA module.

## 8. Migrations planned for Phase 4A

| File | Creates or modifies | Reversible? |
| --- | --- | --- |
| `20261125000100_suppliers.sql` | Creates `supplier_counters`, `suppliers`, the three functions, two permission rows and role grants. Adds nothing to existing tables. | Additive. Rollback would drop only the new objects, and only if no supplier data exists. Not planned; do not drop after use. |
