# Phase 4A review: supplier management (migration 20261125000100, v2)

Status: the migration is a candidate for production review. It is **not yet production-ready** until the remaining items in section 4 are closed. Nothing has been run against the production Supabase project.

## 1. Findings reproduced before the fix

| # | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| 1 | A partial update cleared fields that were not sent (city, mobile). | Probe: update with only `name_en` returned `city=<cleared>`, `mobile=<cleared>`. | Critical |
| 2 | A partial update reset the supplier code to the supplier number. | Probe: `PROBE-A` became `SUP-000001` after a name-only edit. | Critical |
| 3 | `NaN` was accepted as an opening balance and stored. | Probe: `"opening_balance":"NaN"` returned a new supplier. | High |
| 4 | `Infinity` and oversized amounts failed with a raw database error, not a validation message. | Probe: "numeric field overflow". | Medium |
| 5 | An IBAN with a wrong check digit was accepted. Only its shape was checked. | Probe: `SA0380000000608010167518` accepted. | High |

## 2. Fixes in the migration (v2)

- **Partial updates:** on edit, the stored row is merged with the keys sent, and validation runs on the merged result. Unsent keys keep their values. Only an explicit `null` or empty string clears a field. Bookkeeping keys (`id`, `org_id`, `supplier_no`, `row_version`, timestamps, creator) are never taken from the client.
- **Amounts:** plain decimal text only, at most 16 whole digits and 2 decimals. `NaN`, `Infinity`, exponent notation, separators, negatives and oversized values are refused with `supplier.amount_invalid`.
- **IBAN:** the ISO 13616 mod-97 check is applied (`app.iban_checksum_valid`), in SQL and in the TypeScript rules. Test vectors: `SA0380000000608010167519` valid; a changed check digit invalid.
- **Input types:** a non-object payload, a malformed id, a non-boolean `is_active`, and over-long text return validation codes instead of raw cast or length errors.
- **Create versus edit:** a version without an id is refused, so an edit can never create a record.
- **Data layer:** the request now leaves out fields the caller did not set (previously it sent `null`, which clears a field on the server).

## 3. Checks that passed (no change needed)

- **touch_row:** bumps `row_version` by exactly one on each successful update; enforces that `org_id` never changes; sets `created_by` and `updated_by` from the session. Verified by tests: version 1 on create, +1 per save, unchanged after a refusal.
- **audit_row_change:** writes the audit trail for each insert and update. Tested.
- **Authentication and permissions:** `save_supplier`, `list_suppliers` and `get_supplier` check membership (`app.is_org_member`) and the permission (`app.has_permission`) on every call. Tested for owner, admin, manager, storekeeper, accountant, auditor, cashier, outsider.
- **SECURITY DEFINER:** all three functions set a fixed `search_path` (`''`) and are verified by a read-only check. Every table reference inside them is schema-qualified.
- **EXECUTE grants:** the helpers are not executable by signed-in users, anonymous users have no execute, and only the three public functions are granted to signed-in users. Tested.
- **Table privileges and RLS:** the supplier tables have no privileges for signed-in or anonymous users, and RLS is enabled. Financial columns are returned only to `suppliers.manage`.
- **Organisation isolation:** every read and write is scoped to the organisation passed in and checked against membership. A payload naming another organisation is refused. Tested with an outsider and with cross-organisation ids.
- **Concurrency:** simultaneous creates receive distinct numbers; a duplicate code has one winner; two edits from the same version have one winner (committed-transaction tests).
- **Numbering:** a refused create does not consume a number (tested).

## 4. Remaining risks before declaring production-ready

1. **Not run against the live project.** Every result here comes from a local PostgreSQL 16 built from the repository migrations. The install check must be run on the production project after a backup.
2. **Tests run against a stand-in for authentication**, not Supabase Auth. Sign-in, token refresh and session expiry are not covered.
3. **Opening balance is still editable.** It must be locked once purchase and payment entries exist (Phase 4C/4D). Until then, an edit changes the amount owed to the supplier with no ledger entry to match. This needs your approval (decision 4 in the compatibility report).
4. **Clearing the code on edit resets it to the supplier number.** This is deliberate, but it changes a visible identifier if used by mistake. Consider forbidding it once purchase documents reference the supplier.
5. **Supplier numbering is serialised per organisation** by the counter row. Throughput is adequate for a store, not for a very large chain.
6. **Uniqueness of VAT numbers and codes is enforced inside one organisation only.** Two organisations may hold the same VAT number for different branches of one legal entity. This is intended, but it should be confirmed.
7. **Search uses ILIKE over a few columns** with no full-text index. Fine for thousands of suppliers; revisit for very large directories.
8. **Deactivated suppliers remain referenced** by any future document; the migration keeps them, which is intended, but the UI must show them clearly.

## 5. Read-only verification

`supabase/checks/phase4a_suppliers_verify.sql`. Part 1 (20 rows) must be TRUE after installation. Part 2 (7 counts) must be 0 on every run.

## 6. Tests (this review)

| Suite | Result |
| --- | --- |
| Database, main | 215 pass (52 supplier tests, 31 of them before this review, 21 added) |
| Database, concurrency (committed) | 6 pass |
| API over PostgREST | 14 existing + 7 POS and supplier pass |
| Unit | i18n 15, domain 110, ui 4, data 74, web 78 pass |
| Lint, typecheck, production build | pass |
| Install on a fresh database | applied twice without error; verification Part 1 all TRUE; Part 2 all 0 |
| Original reproduction probes | all five findings now behave correctly |
