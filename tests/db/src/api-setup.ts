import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setup as setupDatabase } from './global-setup';
import { JWT_SECRET, POSTGREST_PORT, TEST_DB_URL } from './env';

const DEFAULT_BIN = resolve(import.meta.dirname, '../../../.tools/postgrest');
let proc: ChildProcess | undefined;

/** Recreate the DB, then start a real PostgREST against it. Fails loudly if PostgREST is missing. */
export async function setup(): Promise<void> {
  const bin = process.env.POSTGREST_BIN ?? DEFAULT_BIN;
  if (!existsSync(bin)) {
    throw new Error(`PostgREST binary not found at ${bin}. Run scripts/fetch-postgrest.sh or set POSTGREST_BIN.`);
  }
  await setupDatabase();

  const dbUri = new URL(TEST_DB_URL);
  dbUri.username = 'authenticator';
  dbUri.password = 'authenticator-test-only';

  let output = '';
  proc = spawn(bin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: dbUri.toString(),
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(POSTGREST_PORT),
      PGRST_DB_PRE_CONFIG: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (d) => (output += String(d)));
  proc.stderr?.on('data', (d) => (output += String(d)));

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`PostgREST exited early:\n${output}`);
    try {
      const res = await fetch(`http://127.0.0.1:${POSTGREST_PORT}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`PostgREST did not become ready:\n${output}`);
}

export async function teardown(): Promise<void> {
  proc?.kill('SIGTERM');
}
