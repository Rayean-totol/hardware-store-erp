import { afterAll, describe, expect, it } from 'vitest';
import { asAdmin, asUser, expectDbError, pool, type Sql } from '../db';
import { DEMO_ORG, OTHER_ORG, USERS } from '../env';

afterAll(() => pool.end());

/** A valid supplier payload. Tests override single fields. */
const valid = (over: Record<string, unknown> = {}) => ({
  name_en: 'Najd Fasteners Co.',
  name_ar: 'شركة نجد للمثبتات',
  contact_person: 'Khalid',
  mobile: '+966 50 123 4567',
  whatsapp: '+966501234567',
  email: 'sales@najd.example',
  city: 'Riyadh',
  country_code: 'SA',
  vat_number: '300000000000003',
  cr_number: '1010123456',
  opening_balance: '1500.50',
  credit_limit: '20000.00',
  payment_terms_days: 30,
  bank_name: 'Al Rajhi',
  bank_account_name: 'Najd Fasteners',
  iban: 'SA03 8000 0000 6080 1016 7519',
  ...over,
});

const save = (sql: Sql, org: string, payload: Record<string, unknown>, version: number | null = null) =>
  sql('select public.save_supplier($1, $2::jsonb, $3) as r', [org, JSON.stringify(payload), version]);

/** Expected refusal, run inside a savepoint so the rest of the test transaction stays usable. */
async function refused(sql: Sql, fn: () => Promise<unknown>, code: string | RegExp) {
  await sql('savepoint refused');
  try {
    await expectDbError(fn(), code);
  } finally {
    await sql('rollback to savepoint refused');
  }
}

/** Run as a user, in a transaction that is rolled back. */
const asOwner = <T>(fn: (sql: Sql) => Promise<T>) => asUser(USERS.owner, fn);

describe('suppliers: creation and numbering', () => {
  it('creates a supplier with an auto number, defaults the code to the number, and normalises the IBAN', async () => {
    await asOwner(async (sql) => {
      const { rows } = await save(sql, DEMO_ORG, valid({ supplier_code: '' }));
      const r = rows[0].r as { id: string; supplier_no: string; row_version: number };
      expect(r.supplier_no).toMatch(/^SUP-\d{6}$/);
      expect(r.row_version).toBe(1);
      const p = (await sql('select public.get_supplier($1, $2) as r', [DEMO_ORG, r.id])).rows[0].r;
      expect(p).toMatchObject({ supplier_code: r.supplier_no, iban: 'SA0380000000608010167519', default_currency: 'SAR', opening_balance: '1500.50', is_active: true });
    });
  });

  it('numbers suppliers in sequence within an organisation', async () => {
    await asOwner(async (sql) => {
      const a = (await save(sql, DEMO_ORG, valid({ supplier_code: 'SEQ-A', vat_number: null }))).rows[0].r.supplier_no as string;
      const b = (await save(sql, DEMO_ORG, valid({ supplier_code: 'SEQ-B', vat_number: null }))).rows[0].r.supplier_no as string;
      expect(Number(b.slice(4)) - Number(a.slice(4))).toBe(1);
    });
  });
});

describe('suppliers: validation refuses bad input and writes nothing', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['missing English name', { name_en: '  ' }, 'supplier.name_required'],
    ['missing Arabic name', { name_ar: '' }, 'supplier.name_required'],
    ['code with spaces', { supplier_code: 'BAD CODE' }, 'supplier.code_invalid'],
    ['malformed mobile', { mobile: '12' }, 'supplier.phone_invalid'],
    ['malformed email', { email: 'not-an-email' }, 'supplier.email_invalid'],
    ['VAT number of 14 digits', { vat_number: '30000000000003' }, 'supplier.vat_invalid'],
    ['CR number not 10 digits', { cr_number: '12345' }, 'supplier.cr_invalid'],
    ['non-Saudi IBAN', { iban: 'DE89370400440532013000' }, 'supplier.iban_invalid'],
    ['negative opening balance', { opening_balance: '-5' }, 'supplier.amount_invalid'],
    ['three decimals on credit limit', { credit_limit: '10.005' }, 'supplier.amount_invalid'],
    ['payment terms above 365', { payment_terms_days: 400 }, 'supplier.payment_terms_invalid'],
    ['currency other than SAR', { default_currency: 'USD' }, 'supplier.currency_invalid'],
  ];
  it.each(cases)('%s → %s', async (_name, over, code) => {
    await asOwner(async (sql) => {
      const countAll = async () => (await sql(`select public.list_suppliers($1, null, 'all', 200, 0) as r`, [DEMO_ORG])).rows[0].r.total as number;
      const before = await countAll();
      await refused(sql, () => save(sql, DEMO_ORG, valid({ supplier_code: 'VAL-X', vat_number: null, ...over })), code);
      expect(await countAll()).toBe(before);
    });
  });
});

describe('suppliers: uniqueness', () => {
  it('a supplier code is unique within an organisation (case-insensitive by normalisation)', async () => {
    await asOwner(async (sql) => {
      await save(sql, DEMO_ORG, valid({ supplier_code: 'DUP-1', vat_number: null }));
      await refused(sql, () => save(sql, DEMO_ORG, valid({ supplier_code: 'dup-1', vat_number: null })), 'supplier.code_taken');
          });
  });

  it('a VAT registration number is unique within an organisation', async () => {
    await asOwner(async (sql) => {
      await save(sql, DEMO_ORG, valid({ supplier_code: 'VAT-1', vat_number: '311111111111113' }));
      await refused(sql, () => save(sql, DEMO_ORG, valid({ supplier_code: 'VAT-2', vat_number: '311111111111113' })), 'supplier.vat_taken');
          });
  });

  it('the same code and VAT number may be used by a different organisation (scoped, not global)', async () => {
    await asAdmin(async (sql) => {
      await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.outsider, role: 'authenticated' })]);
      const { rows } = await save(sql, OTHER_ORG, valid({ supplier_code: 'DUP-1', vat_number: '311111111111113' }));
      expect(rows[0].r.supplier_no).toMatch(/^SUP-\d{6}$/);
    });
  });
});

describe('suppliers: organisation isolation', () => {
  it('a user of another organisation cannot list, read or save this organisation’s suppliers', async () => {
    await asOwner(async (sql) => {
      const created = (await save(sql, DEMO_ORG, valid({ supplier_code: 'ISO-1', vat_number: null }))).rows[0].r.id as string;
      await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.outsider, role: 'authenticated' })]);
      await refused(sql, () => sql('select public.list_suppliers($1, null, $2, 50, 0)', [DEMO_ORG, 'all']), 'forbidden');
      await refused(sql, () => sql('select public.get_supplier($1, $2)', [DEMO_ORG, created]), 'forbidden');
      await refused(sql, () => save(sql, DEMO_ORG, valid({ supplier_code: 'ISO-2' })), 'forbidden');
    });
  });

  it('an owner of one organisation cannot read a supplier of another by id', async () => {
    await asAdmin(async (sql) => {
      await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.outsider, role: 'authenticated' })]);
      const other = (await save(sql, OTHER_ORG, valid({ supplier_code: 'OTHER-1', vat_number: null }))).rows[0].r.id as string;
      await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.owner, role: 'authenticated' })]);
      await refused(sql, () => sql('select public.get_supplier($1, $2)', [DEMO_ORG, other]), 'supplier.not_found');
    });
  });

  it('a payload naming another organisation is refused', async () => {
    await asOwner(async (sql) => {
      await refused(sql, () => save(sql, DEMO_ORG, valid({ org_id: OTHER_ORG, supplier_code: 'ORG-X' })), 'forbidden');
    });
  });
});

describe('suppliers: role permissions', () => {
  it('a cashier has no access to the supplier directory', async () => {
    await asUser(USERS.cashier, async (sql) => {
      await refused(sql, () => sql('select public.list_suppliers($1, null, $2, 50, 0)', [DEMO_ORG, 'active']), 'forbidden');
    });
  });

  it('a storekeeper reads the directory without financial fields, and cannot save', async () => {
    await asOwner(async (sql) => {
      const id = (await save(sql, DEMO_ORG, valid({ supplier_code: 'STK-1', vat_number: null }))).rows[0].r.id as string;
      await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.storekeeper, role: 'authenticated' })]);
      const { rows } = await sql('select public.list_suppliers($1, null, $2, 50, 0) as r', [DEMO_ORG, 'active']);
      const item = rows[0].r.items.find((i: { id: string }) => i.id === id);
      expect(item.supplier_code).toBe('STK-1');
      expect(item).not.toHaveProperty('opening_balance');
      expect(item).not.toHaveProperty('credit_limit');
      expect(item).not.toHaveProperty('iban');
      const profile = (await sql('select public.get_supplier($1, $2) as r', [DEMO_ORG, id])).rows[0].r;
      expect(profile).not.toHaveProperty('bank_name');
      await refused(sql, () => save(sql, DEMO_ORG, valid({ supplier_code: 'STK-2' })), 'forbidden');
    });
  });

  it('an auditor and a storekeeper can read but not write; an accountant can read the directory', async () => {
    await asAdmin(async (sql) => {
      await sql(`insert into public.memberships (org_id, user_id, role_id, all_branches)
                 select $1, $2, r.id, true from public.roles r where r.code = 'accountant' and r.is_system`, [DEMO_ORG, USERS.newcomer]);
      await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.newcomer, role: 'authenticated' })]);
      const { rows } = await sql('select public.list_suppliers($1, null, $2, 50, 0) as r', [DEMO_ORG, 'all']);
      expect(Array.isArray(rows[0].r.items)).toBe(true);
      await refused(sql, () => save(sql, DEMO_ORG, valid({ supplier_code: 'ACC-1' })), 'forbidden');
    });
  });

  it('the manager can create and edit suppliers, and sees the financial fields', async () => {
    await asAdmin(async (sql) => {
      await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.manager, role: 'authenticated' })]);
      const created = (await save(sql, DEMO_ORG, valid({ supplier_code: 'MGR-1', vat_number: null }))).rows[0].r as { id: string };
      const profile = (await sql('select public.get_supplier($1, $2) as r', [DEMO_ORG, created.id])).rows[0].r;
      expect(profile.opening_balance).toBe('1500.50');
      expect(profile.iban).toBe('SA0380000000608010167519');
    });
  });
});

describe('suppliers: concurrency and locking', () => {
  it('a stale edit is refused with concurrency_conflict; a current edit succeeds and bumps the version', async () => {
    await asOwner(async (sql) => {
      const first = (await save(sql, DEMO_ORG, valid({ supplier_code: 'LOCK-1', vat_number: null }))).rows[0].r as { id: string; row_version: number };
      const v2 = (await save(sql, DEMO_ORG, valid({ id: first.id, supplier_code: 'LOCK-1', vat_number: null, city: 'Jeddah' }), first.row_version)).rows[0].r as { row_version: number };
      expect(v2.row_version).toBe(2);
      await refused(sql, () => save(sql, DEMO_ORG, valid({ id: first.id, supplier_code: 'LOCK-1', vat_number: null, city: 'Dammam' }), first.row_version), 'concurrency_conflict');
          });
  });

  it('a version without a supplier id is refused, never a silent create', async () => {
    await asOwner(async (sql) => {
      await refused(sql, () => save(sql, DEMO_ORG, valid({ supplier_code: 'NOID-1', vat_number: null }), 1), 'validation');
    });
  });

  it('the supplier number never changes on edit, and a blank code keeps the number as the code', async () => {
    await asOwner(async (sql) => {
      const created = (await save(sql, DEMO_ORG, valid({ supplier_code: '', vat_number: null }))).rows[0].r as { id: string; supplier_no: string; row_version: number };
      await save(sql, DEMO_ORG, valid({ id: created.id, supplier_code: '', vat_number: null, name_en: 'Renamed' }), created.row_version);
      const p = (await sql('select public.get_supplier($1, $2) as r', [DEMO_ORG, created.id])).rows[0].r;
      expect(p).toMatchObject({ supplier_no: created.supplier_no, supplier_code: created.supplier_no, name_en: 'Renamed' });
    });
  });
});

describe('suppliers: listing and search', () => {
  it('filters by status and searches by name, code and mobile; the page size is capped', async () => {
    await asOwner(async (sql) => {
      const active = (await save(sql, DEMO_ORG, valid({ supplier_code: 'SRCH-A', name_en: 'Zephyr Pipes', mobile: '+966555111222', vat_number: null }))).rows[0].r as { id: string; row_version: number };
      const inactive = (await save(sql, DEMO_ORG, valid({ supplier_code: 'SRCH-I', name_en: 'Zephyr Retired', vat_number: null, is_active: false }))).rows[0].r;
      const byName = (await sql('select public.list_suppliers($1, $2, $3, 50, 0) as r', [DEMO_ORG, 'zephyr', 'active'])).rows[0].r;
      expect(byName.items.map((i: { supplier_code: string }) => i.supplier_code)).toEqual(['SRCH-A']);
      const all = (await sql('select public.list_suppliers($1, $2, $3, 50, 0) as r', [DEMO_ORG, 'zephyr', 'all'])).rows[0].r;
      expect(all.total).toBe(2);
      const byMobile = (await sql('select public.list_suppliers($1, $2, $3, 50, 0) as r', [DEMO_ORG, '555111', 'all'])).rows[0].r;
      expect(byMobile.items[0].supplier_code).toBe('SRCH-A');
      expect(inactive).toBeTruthy();
      const capped = (await sql('select public.list_suppliers($1, null, $2, 9999, 0) as r', [DEMO_ORG, 'all'])).rows[0].r;
      expect(capped.limit).toBe(200);
      expect(active.id).toBeTruthy();
    });
  });

  it('a search term containing wildcard characters matches only literally', async () => {
    await asOwner(async (sql) => {
      const { rows } = await sql('select public.list_suppliers($1, $2, $3, 50, 0) as r', [DEMO_ORG, '%', 'all']);
      expect(rows[0].r.items.every((i: { supplier_code: string }) => !i.supplier_code.includes('%'))).toBe(true);
    });
  });
});

describe('suppliers: direct access and audit', () => {
  it('signed-in users and anonymous users cannot read the supplier tables directly', async () => {
    await asOwner(async (sql) => {
      await refused(sql, () => sql('select count(*) from public.suppliers'), /permission denied/);
    });
    await asUser(null, async (sql) => {
      await refused(sql, () => sql('select count(*) from public.suppliers'), /permission denied/);
    });
  });

  it('every create and edit is recorded in the audit log', async () => {
    await asOwner(async (sql) => {
      const r = (await save(sql, DEMO_ORG, valid({ supplier_code: 'AUD-1', vat_number: null }))).rows[0].r as { id: string; row_version: number };
      await save(sql, DEMO_ORG, valid({ id: r.id, supplier_code: 'AUD-1', vat_number: null, city: 'Makkah' }), r.row_version);
      const { rows } = await sql(`select action from public.audit_log where table_name = 'suppliers' and record_id = $1 order by occurred_at`, [r.id]);
      expect(rows.map((x) => x.action)).toEqual(['INSERT', 'UPDATE']);
    });
  });
});

describe('suppliers: partial updates never clear what was not sent', () => {
  it('a partial update changes only the keys sent; everything else survives, and the version moves by one', async () => {
    await asOwner(async (sql) => {
      const c = (await save(sql, DEMO_ORG, valid({ supplier_code: 'KEEP-1', city: 'Riyadh', mobile: '0501234567' }))).rows[0].r as { id: string; row_version: number };
      const r2 = (await save(sql, DEMO_ORG, { id: c.id, name_en: 'Renamed', name_ar: 'اسم جديد' }, c.row_version)).rows[0].r as { row_version: number };
      expect(r2.row_version).toBe(c.row_version + 1);
      const p = (await sql('select public.get_supplier($1, $2) as r', [DEMO_ORG, c.id])).rows[0].r;
      expect(p).toMatchObject({
        name_en: 'Renamed', name_ar: 'اسم جديد', supplier_code: 'KEEP-1', city: 'Riyadh', mobile: '0501234567',
        vat_number: '300000000000003', cr_number: '1010123456', opening_balance: '1500.50', credit_limit: '20000.00',
        iban: 'SA0380000000608010167519', bank_name: 'Al Rajhi', is_active: true, payment_terms_days: 30, row_version: c.row_version + 1,
      });
    });
  });

  it('an explicit null or an empty string clears that field on purpose', async () => {
    await asOwner(async (sql) => {
      const c = (await save(sql, DEMO_ORG, valid({ supplier_code: 'CLR-1' }))).rows[0].r as { id: string; row_version: number };
      await save(sql, DEMO_ORG, { id: c.id, city: null, mobile: '' }, c.row_version);
      const p = (await sql('select public.get_supplier($1, $2) as r', [DEMO_ORG, c.id])).rows[0].r;
      expect(p).not.toHaveProperty('city');
      expect(p).not.toHaveProperty('mobile');
      expect(p.supplier_code).toBe('CLR-1');
    });
  });

  it('a blank code on edit becomes the supplier number, as on creation', async () => {
    await asOwner(async (sql) => {
      const c = (await save(sql, DEMO_ORG, valid({ supplier_code: 'BLANK-1' }))).rows[0].r as { id: string; supplier_no: string; row_version: number };
      await save(sql, DEMO_ORG, { id: c.id, supplier_code: '' }, c.row_version);
      expect((await sql('select public.get_supplier($1, $2) as r', [DEMO_ORG, c.id])).rows[0].r.supplier_code).toBe(c.supplier_no);
    });
  });

  it('a refused edit changes nothing and does not move the version', async () => {
    await asOwner(async (sql) => {
      const c = (await save(sql, DEMO_ORG, valid({ supplier_code: 'REF-1' }))).rows[0].r as { id: string; row_version: number };
      await refused(sql, () => save(sql, DEMO_ORG, { id: c.id, opening_balance: 'NaN' }, c.row_version), 'supplier.amount_invalid');
      const p = (await sql('select public.get_supplier($1, $2) as r', [DEMO_ORG, c.id])).rows[0].r;
      expect(p).toMatchObject({ opening_balance: '1500.50', row_version: c.row_version });
    });
  });

  it('deactivating hides the supplier from the active list; reactivating restores it', async () => {
    await asOwner(async (sql) => {
      const c = (await save(sql, DEMO_ORG, valid({ supplier_code: 'OFF-1', vat_number: null }))).rows[0].r as { id: string; row_version: number };
      const off = (await save(sql, DEMO_ORG, { id: c.id, is_active: false }, c.row_version)).rows[0].r as { row_version: number };
      const active = (await sql(`select public.list_suppliers($1, 'OFF-1', 'active', 50, 0) as r`, [DEMO_ORG])).rows[0].r;
      expect(active.total).toBe(0);
      const inactive = (await sql(`select public.list_suppliers($1, 'OFF-1', 'inactive', 50, 0) as r`, [DEMO_ORG])).rows[0].r;
      expect(inactive.total).toBe(1);
      await save(sql, DEMO_ORG, { id: c.id, is_active: true }, off.row_version);
      expect((await sql(`select public.list_suppliers($1, 'OFF-1', 'active', 50, 0) as r`, [DEMO_ORG])).rows[0].r.total).toBe(1);
    });
  });
});

describe('suppliers: financial amounts, IBAN and input types', () => {
  it.each([
    ['NaN', 'NaN'], ['Infinity', 'Infinity'], ['minus infinity', '-Infinity'], ['exponent notation', '1e3'],
    ['oversized', '99999999999999999999'], ['three decimals', '10.005'], ['negative', '-1'], ['letters', 'abc'], ['thousands separator', '1,000.00'],
  ])('opening balance: %s is refused as an amount', async (_n, value) => {
    await asOwner(async (sql) => {
      await refused(sql, () => save(sql, DEMO_ORG, valid({ opening_balance: value, supplier_code: 'AMT-X', vat_number: null })), 'supplier.amount_invalid');
    });
  });

  it('credit limit is held to the same rule', async () => {
    await asOwner(async (sql) => {
      await refused(sql, () => save(sql, DEMO_ORG, valid({ credit_limit: 'Infinity', supplier_code: 'AMT-Y', vat_number: null })), 'supplier.amount_invalid');
    });
  });

  it('an IBAN with the right shape but wrong check digits is refused; the valid one is accepted', async () => {
    await asOwner(async (sql) => {
      await refused(sql, () => save(sql, DEMO_ORG, valid({ iban: 'SA0380000000608010167518', supplier_code: 'IB-1', vat_number: null })), 'supplier.iban_invalid');
      await save(sql, DEMO_ORG, valid({ iban: 'SA0380000000608010167519', supplier_code: 'IB-2', vat_number: null }));
    });
  });

  it('a non-boolean active flag, a malformed id and a non-object payload are refused with validation codes', async () => {
    await asOwner(async (sql) => {
      await refused(sql, () => save(sql, DEMO_ORG, valid({ is_active: 'yes', supplier_code: 'T-1', vat_number: null })), 'validation');
      await refused(sql, () => save(sql, DEMO_ORG, { id: 'not-a-uuid', name_en: 'X', name_ar: 'س' }, 1), 'validation');
      await refused(sql, () => sql('select public.save_supplier($1, $2::jsonb, null)', [DEMO_ORG, '[1,2]']), 'validation');
    });
  });
});

describe('suppliers: numbering and versions under refusals', () => {
  it('a refused create does not consume a supplier number', async () => {
    await asOwner(async (sql) => {
      const first = (await save(sql, DEMO_ORG, valid({ supplier_code: 'NUM-A', vat_number: null }))).rows[0].r.supplier_no as string;
      await refused(sql, () => save(sql, DEMO_ORG, valid({ supplier_code: 'NUM-A', vat_number: null })), 'supplier.code_taken');
      const third = (await save(sql, DEMO_ORG, valid({ supplier_code: 'NUM-B', vat_number: null }))).rows[0].r.supplier_no as string;
      expect(Number(third.slice(4)) - Number(first.slice(4))).toBe(1);
    });
  });

  it('a new supplier starts at version 1, and each successful save adds exactly one', async () => {
    await asOwner(async (sql) => {
      const a = (await save(sql, DEMO_ORG, valid({ supplier_code: 'VER-1', vat_number: null }))).rows[0].r as { id: string; row_version: number };
      expect(a.row_version).toBe(1);
      const b = (await save(sql, DEMO_ORG, { id: a.id, city: 'Dammam' }, a.row_version)).rows[0].r as { row_version: number };
      const c = (await save(sql, DEMO_ORG, { id: a.id, city: 'Khobar' }, b.row_version)).rows[0].r as { row_version: number };
      expect([b.row_version, c.row_version]).toEqual([2, 3]);
    });
  });
});

describe('suppliers: roles and search', () => {
  it('an admin, like the owner, can create and edit suppliers', async () => {
    await asAdmin(async (sql) => {
      await sql(`insert into public.memberships (org_id, user_id, role_id, all_branches)
                 select $1, $2, r.id, true from public.roles r where r.code = 'admin' and r.is_system`, [DEMO_ORG, USERS.newcomer]);
      await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.newcomer, role: 'authenticated' })]);
      const r = (await save(sql, DEMO_ORG, valid({ supplier_code: 'ADM-1', vat_number: null }))).rows[0].r as { id: string; row_version: number };
      await save(sql, DEMO_ORG, { id: r.id, city: 'Tabuk' }, r.row_version);
    });
  });

  it('search finds a supplier by its supplier number and by its VAT number', async () => {
    await asOwner(async (sql) => {
      const r = (await save(sql, DEMO_ORG, valid({ supplier_code: 'FIND-1', vat_number: '322222222222223' }))).rows[0].r as { supplier_no: string };
      const byNo = (await sql(`select public.list_suppliers($1, $2, 'all', 50, 0) as r`, [DEMO_ORG, r.supplier_no])).rows[0].r;
      expect(byNo.items.map((i: { supplier_code: string }) => i.supplier_code)).toContain('FIND-1');
      const byVat = (await sql(`select public.list_suppliers($1, '322222222222223', 'all', 50, 0) as r`, [DEMO_ORG])).rows[0].r;
      expect(byVat.items.map((i: { supplier_code: string }) => i.supplier_code)).toEqual(['FIND-1']);
    });
  });
});
