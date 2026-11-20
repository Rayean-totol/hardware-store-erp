/**
 * Test database configuration. Tests FAIL (not skip) when the database is unreachable.
 * TEST_PG_ADMIN_URL must point at a maintenance DB of a PostgreSQL 15+ server whose
 * user may create databases and roles (CI uses the postgres superuser of a service container).
 */
export const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
export const TEST_DB = process.env.TEST_PG_DATABASE ?? 'erp_test';
export const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);

export const POSTGREST_PORT = Number(process.env.TEST_POSTGREST_PORT ?? 54330);
/** Test-only HS256 secret shared by PostgREST and the JWTs the tests sign. */
export const JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';

export const DEMO_ORG = '00000000-0000-4000-8000-000000000001';
export const USERS = {
  owner: 'a0000000-0000-4000-8000-000000000001',
  manager: 'a0000000-0000-4000-8000-000000000002',
  storekeeper: 'a0000000-0000-4000-8000-000000000003',
  cashier: 'a0000000-0000-4000-8000-000000000004',
  auditor: 'a0000000-0000-4000-8000-000000000005',
  outsider: 'a0000000-0000-4000-8000-000000000006',
  newcomer: 'a0000000-0000-4000-8000-000000000007',
} as const;
export const OTHER_ORG = '00000000-0000-4000-8000-000000000002';
