# AI product photo recognition: runbook (prepared, not active)

Status: **prepared in code. Not deployed, not active, no paid service enabled.**
Provider: Google Gemini, Flash-Lite model `gemini-2.5-flash-lite` (set in `supabase/functions/product-photo-suggest/logic.ts`).
Monthly budget: **10 SAR per organisation**, enforced in the database before every call.

## What is in place

| Piece | File | State |
|---|---|---|
| Edge Function (server side) | `supabase/functions/product-photo-suggest/index.ts` | Written. Type-checked with Deno. Off unless `AI_PHOTO_ENABLED=true`. |
| Pure logic: budget, validation, prompt | `supabase/functions/product-photo-suggest/logic.ts` | Written. 13 unit tests pass. |
| Budget table and reserve function | `supabase/migrations/20261128000100_ai_photo_budget.sql` | Written. **Not applied to any database.** 5 DB tests pass on the test database. |
| Product form "AI suggest" button | not built | Waits for the function to be deployed and enabled. |

## Cost model

- Reserved per call (worst case): 1,500 input tokens and 600 output tokens.
- That is about SAR 0.0015 per call, so the 10 SAR cap allows about 6,800 calls a month per organisation.
- The reserved amount is charged even if the provider fails, so the cap can never be exceeded.
- **Prices are unverified.** The price search gave conflicting figures, so check
  `https://ai.google.dev/pricing` for image input and the current Flash-Lite price before enabling.

## Data sent to the provider

Only the compressed photo (JPEG or PNG, at most 1 MB) and a fixed instruction, plus the organisation's
category and unit names. No customer, sales, stock, supplier or financial data. The function does not
store the photo. Check Google's data-use terms for the paid tier before enabling.

## Activation steps (each needs your approval)

1. Apply migration `20261128000100_ai_photo_budget.sql` to the live database. Apply
   `20261127000100` (PR #18) first if it is not applied yet.
2. Deploy the function: `supabase functions deploy product-photo-suggest`.
3. Set secrets (never commit them):
   - `supabase secrets set GEMINI_API_KEY=<key from Google AI Studio>`
   - `supabase secrets set ALLOWED_ORIGIN=https://rayean-totol.github.io`
   - `supabase secrets set AI_PHOTO_ENABLED=true` (leave unset to keep the function off)
4. Test with about 20 real product photos and measure the real cost in the Google console.
5. Only then add the product form button.

To switch it off at any time: `supabase secrets unset AI_PHOTO_ENABLED`.

## Not done

- No Google API key exists in this project, and none was requested or used.
- No function was deployed and no migration was applied to the live database.
- The product form button is not built.
