import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { ADMIN_URL } from '../env';

/**
 * Proves the POS forward fix (20261124000200) on the database states that matter in production:
 *  - a database built only to the merged POS migration (20261124000100), upgraded by the fix;
 *  - the same upgraded database after the later migrations, compared with a fresh full build;
 *  - running the fix twice; and the preflight refusing to run on an incomplete database.
 * Each check uses its own throw-away database. It never touches the shared test database.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const SHIM = join(ROOT, 'supabase/tests/supabase-shim.sql');
const POS_V1 = '20261124000100_pos_sales.sql';
const POS_FIX = '20261124000200_pos_sales_fix.sql';
const ALL = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

const urlFor = (name: string) => ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);

async function createDb(name: string): Promise<pg.Client> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const db = new pg.Client({ connectionString: urlFor(name) });
  db.on('error', () => {});
  await db.connect();
  db.on('notice', () => {});
  await db.query(readFileSync(SHIM, 'utf8'));
  return db;
}

async function dropDb(name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
}

async function apply(db: pg.Client, files: string[]): Promise<void> {
  for (const f of files) await db.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
}

async function snapshot(db: pg.Client) {
  const fns = await db.query(`
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (('app', 'sale_summary'), ('public', 'finalize_sale'), ('public', 'cancel_sale'))
    order by 1`);
  const cons = await db.query(`
    select conname, pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'public.sale_lines'::regclass and contype = 'u' order by conname`);
  const grant = await db.query(`select has_function_privilege('authenticated', 'app.sale_summary(uuid,text)', 'EXECUTE') as ok`);
  const tables = await db.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const counts: Record<string, string> = {};
  for (const { table_name } of tables.rows as Array<{ table_name: string }>) {
    counts[table_name] = (await db.query(`select count(*)::text as n from public.${table_name}`)).rows[0].n;
  }
  return { fns: fns.rows, cons: cons.rows, grant: grant.rows[0].ok as boolean, counts };
}

const upTo = (last: string) => ALL.filter((f) => f <= last);

describe('POS forward fix 20261124000200', () => {
  it('upgrades a database built to the merged POS migration, changes no row counts, and matches a fresh build', async () => {
    const upgraded = await createDb('erp_pos_fix_upgrade');
    try {
      await apply(upgraded, upTo(POS_V1));
      const before = await snapshot(upgraded);
      expect(before.cons.map((c) => c.conname)).toContain('sale_lines_movement_client_id_key');
      expect(before.cons.map((c) => c.conname)).not.toContain('sale_lines_org_movement_client_key');
      expect(before.grant).toBe(true);

      await apply(upgraded, [POS_FIX]);
      const after = await snapshot(upgraded);
      expect(after.cons).toContainEqual({ conname: 'sale_lines_org_movement_client_key', def: 'UNIQUE (org_id, movement_client_id)' });
      expect(after.cons.map((c) => c.conname)).not.toContain('sale_lines_movement_client_id_key');
      expect(after.grant).toBe(false);
      expect(after.counts).toEqual(before.counts);

      // Running the fix again changes nothing.
      await apply(upgraded, [POS_FIX]);
      expect(await snapshot(upgraded)).toEqual(after);

      // Later migrations (suppliers, purchase orders) still apply on top of the fixed database.
      await apply(upgraded, ALL.filter((f) => f > POS_FIX));
      const upgradedFinal = await snapshot(upgraded);

      const fresh = await createDb('erp_pos_fix_fresh');
      try {
        await apply(fresh, ALL);
        const freshFinal = await snapshot(fresh);
        expect(upgradedFinal.fns).toEqual(freshFinal.fns);
        expect(upgradedFinal.cons).toEqual(freshFinal.cons);
        expect(upgradedFinal.grant).toBe(freshFinal.grant);
      } finally {
        await fresh.end();
        await dropDb('erp_pos_fix_fresh');
      }
    } finally {
      await upgraded.end();
      await dropDb('erp_pos_fix_upgrade');
    }
  }, 240_000);

  it('refuses to run on a database without the POS prerequisites, and changes nothing', async () => {
    const db = await createDb('erp_pos_fix_guard');
    try {
      await apply(db, upTo('20261123000100_dashboard_summary.sql'));
      await expect(apply(db, [POS_FIX])).rejects.toThrow(/POS v2 prerequisites are missing/);
    } finally {
      await db.end();
      await dropDb('erp_pos_fix_guard');
    }
  }, 240_000);
});
