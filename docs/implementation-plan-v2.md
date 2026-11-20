# Al Qureshi Hardware ERP Pro — implementation plan (v2)

Status legend: **Built** (working, tested) · **Phase N** (planned, not built) · **Blocked** (needs a decision or external service).

## Current state (inspected on `main`)

| Area | State |
| --- | --- |
| Auth, organisation onboarding, team | Built (Phase 1) |
| Products, categories, brands, units, multi-unit, barcodes | Built (Phase 1) |
| Warehouses, stock in / out / adjustment, costing, low stock, history | Built (Phase 2) |
| Offline stock outbox, price tiers, CSV import/export, barcode labels | Built (Phase 2) |
| Least-privilege grants and TRUNCATE lock-down | Built (hardening migration, PR #3) |
| Premium dark design, collapsible shell, real dashboard | **This phase (Phase 1 of v2)** |
| POS / sales, returns, invoices, receipts | Phase 3 (no tables yet) |
| Purchases, supplier payments, purchase returns | Phase 4 (no tables yet) |
| Customers, customer receivables, statements | Phase 5 |
| Accounting: cash/bank accounts, journals, trial balance, P&L, balance sheet | Phase 6 |
| Expenses, owner investment/withdrawal, loans | Phase 6 |
| Staff attendance, shifts, salaries, activity history | Phase 7 |
| Reports centre (sales, purchases, VAT, stock valuation, PDF/CSV/print) | Phase 8 |
| VAT summary, invoice numbering, ZATCA Phase 2 integration | Phase 9 — **Blocked** until ZATCA sandbox credentials and the Phase 2 specification review are complete. A QR code or PDF is not ZATCA Phase 2 compliance. |
| Backup & restore (JSON/CSV exports, restore preview) | Phase 10. A browser export is not a Supabase disaster-recovery backup; full recovery uses Supabase backups. |
| Offline PWA (installable, offline drafts, sync queue for sales/purchases) | Phase 11 (stock outbox exists from Phase 2) |
| Settings (business profile, logo, numbering, time zone, printers) | Phase 12 |

## Phases

1. **Premium dark design system, responsive shell, real dashboard** (this phase).
   - Dark-only theme tokens from the supplied reference, shared by every screen.
   - Collapsible desktop sidebar, mobile drawer, language switcher.
   - Dashboard showing only figures that exist in the database today: stock value, stock positions,
     product count, low-stock and out-of-stock counts, and the low-stock list. Other figures show
     "Not available yet" with the phase that adds them. No sample numbers anywhere.
   - Migration `dashboard_inventory_summary` (security invoker, permission-checked, branch-scoped).
   - Tests: database (values, branch scope, permissions, isolation), unit/component (dashboard, shell).
2. Products catalogue visual redesign (image cards, grid/list toggle, detail panel). Image upload
   exists; multiple images, variants and camera capture are not built.
3. POS / sales (after Phase 2 stock): sales, lines, tenders, VAT, returns, invoice numbering, receipts.
4. Purchasing: invoices, receiving (partial), supplier payments, returns.
5. Customers and suppliers: profiles, ledgers, statements, receivables and payables.
6. Accounting: double-entry journals enforced by the database, cash/bank, trial balance, P&L, balance sheet.
7. Staff: attendance, shifts, salary records, activity history.
8. Reports centre, all sourced from the same transactions.
9. VAT and ZATCA Phase 2 (blocked on the items above).
10. Backup and restore.
11. Offline-first PWA for sales and purchases.
12. Settings and printer configuration.

## Rules that apply to every phase

- Every displayed amount comes from the database. A missing module shows "Not available yet".
- Financial and stock writes go through database functions that run in one transaction and are idempotent.
- Destructive database changes are shown as the exact SQL and need explicit approval first.
- No service-role key in the frontend. Trusted operations use Supabase Edge Functions when needed.
