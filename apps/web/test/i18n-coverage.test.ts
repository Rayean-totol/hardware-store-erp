import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@erp/i18n';

// Tests run from apps/web (see the `test` script); jsdom does not expose file URLs.
const MIGRATIONS = resolve(process.cwd(), '../../supabase/migrations');

/** Error codes raised by app.fail() in the migrations. */
function databaseCodes(): string[] {
  const sql = readdirSync(MIGRATIONS).map((f) => readFileSync(`${MIGRATIONS}/${f}`, 'utf8')).join('\n');
  return [...new Set([...sql.matchAll(/app\.fail\('([a-z_.]+)'/g)].map((m) => m[1]!))];
}

/** Codes produced by the client-side domain and sync engine (validation and queueing). */
const CLIENT_ISSUE_CODES = [
  'stock.invalid_type', 'quantity.invalid', 'quantity.not_positive', 'stock.reason_required', 'stock.reason_invalid',
  'cost.required', 'cost.negative', 'price.invalid', 'price.negative', 'price.min_quantity', 'price.duplicate', 'price.unit',
  'csv.malformed', 'csv.empty', 'csv.missing_column', 'import.unknown_unit', 'import.base_unit_conflict',
  'import.unknown_category', 'import.unknown_brand',
];

const CLIENT_ERROR_CODES = [
  'offline.catalog_missing', 'offline.product_unknown', 'quantity.fraction_not_allowed', 'quantity.precision',
  'stock.insufficient', 'product.not_stock', 'product.archived', 'unit.not_configured', 'network', 'missing_result',
  'image.type', 'image.too_large', 'storage.upload_failed', 'storage.url_failed', 'auth.failed', 'not_found', 'forbidden',
];

const hasText = (code: string) => {
  const catalog = en as Record<string, string>;
  return catalog[`errors.${code}`] !== undefined || catalog[`issues.${code}`] !== undefined;
};

describe('translation coverage', () => {
  it('every database error code has a message', () => {
    const missing = databaseCodes().filter((c) => !hasText(c));
    expect(missing).toEqual([]);
  });

  it('every client-side validation and sync code has a message', () => {
    const missing = [...CLIENT_ISSUE_CODES, ...CLIENT_ERROR_CODES].filter((c) => !hasText(c));
    expect(missing).toEqual([]);
  });

  it('the database produces at least the stock codes this suite checks', () => {
    expect(databaseCodes()).toEqual(expect.arrayContaining(['stock.insufficient', 'stock.reason_required', 'cost.required']));
  });
});
