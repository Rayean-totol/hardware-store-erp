import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { ADMIN_URL, DEMO_ORG, OTHER_ORG, TEST_DB, TEST_DB_URL, USERS } from './env';

const ROOT = resolve(import.meta.dirname, '../../..');

/** Recreate the test DB: Supabase shim → migrations (in order) → seed → test users. */
export async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Cannot connect to PostgreSQL at TEST_PG_ADMIN_URL=${ADMIN_URL}. ` +
        'Start Postgres 15+ or set TEST_PG_ADMIN_URL (see docs/setup.md).',
      { cause: error },
    );
  }
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const db = new pg.Client({ connectionString: TEST_DB_URL });
  await db.connect();
  db.on('notice', () => {});
  try {
    await db.query(readFileSync(join(ROOT, 'supabase/tests/supabase-shim.sql'), 'utf8'));
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
    for (const file of migrations) {
      try {
        await db.query(readFileSync(join(ROOT, 'supabase/migrations', file), 'utf8'));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    await db.query(readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8'));

    // Test users (auth.users is the shim's minimal table) and memberships.
    for (const [name, id] of Object.entries(USERS)) {
      await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name}@example.test`]);
    }
    await db.query(
      `insert into public.organizations (id, legal_name_en, legal_name_ar) values ($1, 'Other Store LLC', 'متجر آخر')`,
      [OTHER_ORG],
    );
    await db.query(`insert into public.branches (org_id, code, name_en, name_ar) values ($1, 'MAIN', 'Main', 'الرئيسي')`, [OTHER_ORG]);
    const member = (org: string, user: string, role: string, allBranches = true) =>
      db.query(
        `insert into public.memberships (org_id, user_id, role_id, all_branches)
         select $1, $2, id, $4 from public.roles where code = $3 and org_id is null`,
        [org, user, role, allBranches],
      );
    await member(DEMO_ORG, USERS.owner, 'owner');
    await member(DEMO_ORG, USERS.manager, 'manager', false);
    await member(DEMO_ORG, USERS.storekeeper, 'storekeeper');
    await member(DEMO_ORG, USERS.cashier, 'cashier', false);
    await member(DEMO_ORG, USERS.auditor, 'auditor');
    await member(OTHER_ORG, USERS.outsider, 'owner');
    // Manager and cashier are restricted to the Riyadh branch (matches scripts/create-demo-users.mjs).
    // Without these rows a branch-restricted member sees no branch at all.
    await db.query(
      `insert into public.membership_branches (membership_id, org_id, branch_id)
       select m.id, m.org_id, b.id from public.memberships m join public.branches b on b.org_id = m.org_id and b.code = 'RUH'
       where m.user_id = any($1::uuid[])`,
      [[USERS.manager, USERS.cashier]],
    );
  } finally {
    await db.end();
  }
}
