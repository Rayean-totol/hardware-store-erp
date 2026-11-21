# AI product photo recognition and auto-fill: proposal (not implemented)

Status: **proposal. No AI code is built, and no provider is called.** It needs your decisions
on the provider, the model, and a monthly budget before any code is written.

## 1. Why a server is required

The app is a static site on GitHub Pages. Anything in the browser bundle is visible to every visitor,
so a provider API key cannot live there. The AI call must run on the server side, and the only
server this project can use without a new host is a **Supabase Edge Function**. It runs with a
secret stored in Supabase, not in the repository or the browser.

## 2. Proposed design

```
Phone (browser)  --photo, compressed to JPEG <= 1024 px-->  Supabase Edge Function "product-photo-suggest"
                                                              |  1. verifies the user's login token
                                                              |  2. checks catalog.write for the org (same rule as the app)
                                                              |  3. checks a per-user and per-org rate limit
                                                              |  4. calls the AI provider with the API key from Supabase secrets
                                                              |  5. validates the answer against a strict schema
                                                              v
Phone  <--- suggestions (JSON) ---------------------------------
```

- **Who can use it:** only signed-in users with `catalog.write`. The function calls the database as
  the user, so the existing row policies apply.
- **Key handling:** the provider key is stored with `supabase secrets set`. It is never committed,
  never sent to the browser, and never logged.
- **What is sent to the provider:** the compressed photo and a fixed instruction. No customer,
  sales, stock, supplier or financial data.
- **What comes back:** a JSON object with a fixed set of fields. Anything outside the schema is dropped.
- **Image handling:** the photo is not stored by the function. Check the provider's data-retention
  terms before you approve (section 5).
- **Optional:** if the function is not deployed, the AI button is hidden. Normal product management
  is unchanged.

## 3. What the AI may suggest, and what it may never invent

May suggest (every field editable before saving, and each marked as a suggestion):
- English name, Saudi Arabic name, Bangla name;
- category (chosen from the organisation's existing categories only);
- product type and a short description;
- common sizes and units (chosen from the existing unit list);
- a proposed SKU (the app's SKU rule applies; it must not already exist).

Must never suggest or fill automatically: **barcode, purchase price, selling price, stock quantity**.

Every suggestion carries a confidence value. Arabic and Bangla names are marked "please check" by default.

## 4. Security and abuse controls

- Input limits: one photo, at most 1024 px, at most 1 MB.
- Output validation: category and unit must match the organisation's existing lists; text is
  length-limited; anything else is discarded.
- Prompt injection: text written on a product (labels, packaging) is treated as data, not as
  instructions. The function ignores any instruction found in the photo.
- Rate limits: per user and per organisation, per hour and per day, to cap cost.
- Logs: request time, user id, org id and result status only. No image, no name, no key.
- Failure: a provider error or timeout returns "suggestions unavailable". The form still saves normally.

## 5. Costs (to confirm before implementation)

Each suggestion costs: input tokens for the photo and instruction, plus output tokens for the JSON
answer. The exact cost depends on the model and on the photo size, so it has to be measured on
about 20 real product photos before any budget is set.

Prices I checked (search results disagree; confirm on the official page before deciding):
- Anthropic API pricing: https://platform.claude.com/docs/en/about-claude/pricing
- A pricing summary that lists current rates: https://finout.io/blog/anthropic-api-pricing
- Another summary with different figures: https://dev.to/claudeguide/claude-api-pricing-2026-complete-breakdown-with-calculators-26c8

The search did not confirm **image token pricing**, so no per-photo cost is quoted here.
Supabase Edge Function pricing depends on the Supabase plan. Check it on the Supabase pricing page
before deployment.

Cost control options: a smaller model for suggestions, a monthly cap per organisation, and a
manual "suggest" button rather than suggesting on every photo.

## 6. Decisions needed from you

1. Provider and model (a vision-capable model is required).
2. Monthly budget cap for suggestions, and what happens at the cap (block, or continue and report).
3. Whether suggestions may be sent to the provider at all, given your data-privacy requirements.
4. Approval to deploy the Edge Function to your Supabase project (this is a production change).

## 7. Order of work once approved

1. Edge Function with the strict schema, unit tests with a mocked provider, rate limits.
2. The "AI suggest" button on the product form, shown only when the function responds to a health check.
3. Tests for permissions (cashier and storekeeper refused), output validation, and failure handling.
4. Test with 20 real photos on staging, measure cost, then decide on the budget.
