// Create demo users through the Supabase Auth admin API and attach them to the seeded demo
// organization. LOCAL DEVELOPMENT ONLY. Requires the service-role key (never ship it to clients).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_PASSWORD=... node scripts/create-demo-users.mjs
//
// Idempotent: existing users and memberships are left as they are.
import { createClient } from '@supabase/supabase-js';

const DEMO_ORG = '00000000-0000-4000-8000-000000000001';
const USERS = [
  { email: 'owner@demo.local', name: 'Demo Owner', role: 'owner', branches: null },
  { email: 'manager@demo.local', name: 'Demo Manager', role: 'manager', branches: ['RUH'] },
  { email: 'storekeeper@demo.local', name: 'Demo Storekeeper', role: 'storekeeper', branches: null },
  { email: 'cashier@demo.local', name: 'Demo Cashier', role: 'cashier', branches: ['RUH'] },
  { email: 'auditor@demo.local', name: 'Demo Auditor', role: 'auditor', branches: null },
];

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const url = required('SUPABASE_URL');
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
const password = required('DEMO_PASSWORD');
if (password.length < 8) {
  console.error('DEMO_PASSWORD must be at least 8 characters');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function check(result, what) {
  if (result.error) {
    console.error(`${what} failed:`, result.error.message ?? result.error);
    process.exit(1);
  }
  return result.data;
}

const org = check(await db.from('organizations').select('id').eq('id', DEMO_ORG).maybeSingle(), 'Load demo org');
if (!org) {
  console.error('Demo organization not found. Run `supabase db reset` (applies seed.sql) first.');
  process.exit(1);
}

const roles = check(await db.from('roles').select('id, code').is('org_id', null), 'Load roles');
const branches = check(await db.from('branches').select('id, code').eq('org_id', DEMO_ORG), 'Load branches');
const existing = check(await db.auth.admin.listUsers({ perPage: 1000 }), 'List users').users;

for (const u of USERS) {
  let user = existing.find((x) => x.email === u.email);
  if (!user) {
    user = check(
      await db.auth.admin.createUser({ email: u.email, password, email_confirm: true, user_metadata: { full_name: u.name } }),
      `Create ${u.email}`,
    ).user;
    console.log(`created ${u.email}`);
  } else {
    console.log(`exists  ${u.email}`);
  }

  const roleId = roles.find((r) => r.code === u.role)?.id;
  const membership = check(
    await db.from('memberships').select('id').eq('org_id', DEMO_ORG).eq('user_id', user.id).maybeSingle(),
    `Load membership ${u.email}`,
  );
  if (membership) continue;

  const inserted = check(
    await db
      .from('memberships')
      .insert({ org_id: DEMO_ORG, user_id: user.id, role_id: roleId, all_branches: u.branches === null })
      .select('id')
      .single(),
    `Add membership ${u.email}`,
  );
  if (u.branches) {
    const rows = u.branches.map((code) => ({
      membership_id: inserted.id,
      org_id: DEMO_ORG,
      branch_id: branches.find((b) => b.code === code)?.id,
    }));
    check(await db.from('membership_branches').insert(rows), `Assign branches ${u.email}`);
  }
  console.log(`  → ${u.role}${u.branches ? ` (${u.branches.join(', ')})` : ' (all branches)'}`);
}
console.log('Done.');
