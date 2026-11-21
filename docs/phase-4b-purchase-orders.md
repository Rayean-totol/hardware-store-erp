# Phase 4B: purchase orders

Status: built on branch `claude/phase-4b-purchase-orders` (stacked on `claude/phase-4a-suppliers`). Nothing has been run against production, and nothing is merged.

## What is built

| Area | Delivered |
| --- | --- |
| Database | `purchase_orders`, `purchase_order_lines`, `purchase_order_events` (history), `purchase_order_counters`; functions to create, update (drafts), submit, approve, cancel, list and get |
| Lifecycle | draft → submitted → approved → cancelled. `partially_received` and `fully_received` exist but are set only by Phase 4C receiving |
| Controls | only drafts change; lines locked by trigger after a draft; orders never deleted; no self-approval (function check and table check); every transition in an append-only history and in the audit log |
| Money | the POS and domain rules: discount before VAT, per-line rounding to 2 dp, net + VAT = gross. The VAT-inclusive flag and rate are copied onto each order |
| Stock | an order never changes stock. Tests confirm no stock change and no stock movement across create, submit and approve |
| Costs | unit costs, discounts, VAT and totals are returned only to `purchase.cost_view` holders |
| Branches | every read and action is checked against the user's branch access; a branch-restricted manager cannot see or open another branch's orders |
| Permissions | `purchase.read`, `purchase.create`, `purchase.approve`, `purchase.void`, `purchase.cost_view` |
| Screens | list with status, supplier and branch filters; create and edit a draft (product search, purchase unit, cost, discount, live totals); detail with the actions the user may take |
| Navigation | Purchase (`/purchase-orders/`) for users with `purchase.read` |

## Decisions for approval

1. **No self-approval.** The creator never approves their own order, even an owner. Enforced in the function and by a table constraint.
2. **Editing.** The creator may edit a draft, and an approver may edit any draft. Anyone else is refused.
3. **Cancel needs a reason** of 5–500 characters, and is refused once any goods are received (returns come in 4E).
4. **Costs are hidden** from storekeepers, cashiers and anyone without `purchase.cost_view`. Accountants and auditors see costs.
5. **Attachments deferred to 4C.** Purchase order documents need storage rules designed with receiving, so they are not built here.
6. **Receiving, purchase invoices and supplier payments are not built.** A purchase order records intent only.

## Verification

- Database (main): 258 pass, including 35 purchase-order tests (creation, 17 refusal paths each checked for no write, stock unchanged, workflow, separation of duties, stale versions, editing rules, cost visibility, branch isolation, listing, history, direct-access denial, VAT-exclusive pricing).
- Concurrency (committed, own database): 9 pass, including 3 purchase-order cases (two approvers at once, a double submit of one creation, five simultaneous creates with distinct numbers).
- API over PostgREST: 14 + 7 pass (no purchase-order API test yet).
- Unit: i18n 15, domain 128, ui 4, data 80, web 90 pass.
- Lint, typecheck and production build pass; `/purchase-orders` routes generated.
- Install on a fresh database after 4A: applied twice without errors; existing rows unchanged; verification Part 1 has 18 TRUE after installation; Part 2 has 6 counts, all 0.

## Install (after review; never automatic)

1. Back up the Supabase project. Confirm Phase 4A is installed (`phase4a_suppliers_verify.sql`, Part 1 all TRUE).
2. Run `supabase/checks/phase4b_purchase_verify.sql`. Expect the purchase rows to be FALSE.
3. In the SQL Editor, paste `supabase/migrations/20261126000100_purchase_orders.sql` and run it once.
4. Run the check again. Part 1 should be all TRUE and Part 2 all 0.

## Known limits

- Purchase orders are not connected to stock or accounts until 4C and 4D.
- Editing a draft replaces its lines, which keeps the order consistent but loses per-line history inside a draft.
- The purchase unit on an edited line is limited to the units the product still offers.
- Search on the form needs at least two characters.
