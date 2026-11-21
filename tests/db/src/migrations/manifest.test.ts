import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the migration set itself (no database needed).
 *  - Names follow the Supabase CLI format and sort in apply order.
 *  - Migrations that were already merged are unchanged (SHA-256 recorded below).
 *  - The security hardening migration contains no destructive statements.
 * When a new migration is merged, add its checksum to APPLIED_CHECKSUMS.
 */
const DIR = resolve(process.cwd(), '../../supabase/migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const APPLIED_CHECKSUMS: Record<string, string> = {
  '20261120000100_foundation.sql': '1c370599e284219aa70ae983169abd01987c13e345cb3559306efeec77f587d9',
  '20261120000200_rbac.sql': '6698264904c805e332fe432b800f3945875acbe25f240223583949b4f2283bff',
  '20261120000300_audit.sql': '627a6fb9c7ff4e027e9778b0c28cd2a0f27b8a9d4586dae95296fddc22823234',
  '20261120000400_catalog.sql': '45426d0fec2d864943c2e4f5cf5eb0a0e5e286d4418bc377420941da40b4688a',
  '20261120000500_catalog_rpc.sql': '417a4bc0f07c1b06d9f4cf874679c3931cf711f390669ff4917741f0d693b4a3',
  '20261121000100_warehouses.sql': '1c0e5479ed694b49c53182319e23336aa62db7afc47140d00d9894663b48fa66',
  '20261121000200_stock_ledger.sql': '3945d884b613b65acc9d1095227a70b35be1f9e1c75b953c8c963a17f1ffd8ff',
  '20261121000300_stock_rpc.sql': '67bd8a05030d1b5e9714d5597023614f75066099d617fae7235139528e577594',
  '20261121000400_prices_media_search.sql': 'f57c53904a7bfde99a9de631ad8d67a8a394d8182e350331f3c4ec97ed0d6a54',
  '20261122000100_security_hardening.sql': 'd5a3c0e001e83f5d5c1c0f817182c202a0d7d56650aebe4c5e25ba9ce4ba2f59',
  '20261123000100_dashboard_summary.sql': '9c5f2e6a7bcad5d66941f0568b2ba60309b8a1a02a29a65eed6e43660d4b2f55',
  '20261124000100_pos_sales.sql': 'dd650d7115dee5a577fe4d5f80a2620cb2cf0256eae3e5843f7e930607b0ece8',
};

const sha = (f: string) => createHash('sha256').update(readFileSync(resolve(DIR, f))).digest('hex');

describe('migration set', () => {
  it('file names use the Supabase CLI format and are unique', () => {
    for (const f of FILES) expect(f, f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(new Set(FILES).size).toBe(FILES.length);
  });

  it('already-merged migrations are unchanged', () => {
    for (const [file, expected] of Object.entries(APPLIED_CHECKSUMS)) {
      expect(sha(file), file).toBe(expected);
    }
  });

  it('every migration up to the newest pinned one is pinned (newer ones are not merged yet)', () => {
    // Migrations after the newest pin are pending: they are pinned once merged. Derived from the
    // pins, so adding a migration never edits this file.
    const newestPinned = Object.keys(APPLIED_CHECKSUMS).sort().at(-1)!;
    const unrecorded = FILES.filter((f) => f <= newestPinned && !(f in APPLIED_CHECKSUMS));
    expect(unrecorded).toEqual([]);
  });
});

describe('security hardening migration is non-destructive', () => {
  const sql = readFileSync(resolve(DIR, '20261122000100_security_hardening.sql'), 'utf8')
    .replace(/--[^\n]*/g, '');   // ignore comments

  it.each([
    ['drop table', /\bdrop\s+table\b/i],
    ['drop schema', /\bdrop\s+schema\b/i],
    ['drop column', /\bdrop\s+column\b/i],
    ['delete from public data', /\bdelete\s+from\s+(public|app|auth|storage)\./i],
    ['truncate statement', /\btruncate\s+(only\s+)?(table\s+)?(public|app|auth|storage)\./i],
    ['data update of tenant tables', /\bupdate\s+public\.(organizations|memberships|products|stock_movements)\s+set\b/i],
  ])('contains no %s', (_name, pattern) => {
    expect(pattern.test(sql)).toBe(false);
  });

  it('does not grant anything to anon', () => {
    expect(/grant\s[^;]*\bto\b[^;]*\banon\b/i.test(sql)).toBe(false);
  });
});
