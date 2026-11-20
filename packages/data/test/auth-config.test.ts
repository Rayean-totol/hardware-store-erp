import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkProjectUrl, createBrowserClient, readSupabaseConfig } from '../src';

const KEY = 'sb_publishable_testkeyonly_0000000000';
const b64url = (o: object) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('project URL validation', () => {
  it.each([
    ['https://abcdefgh.supabase.co', true],
    ['https://abcdefgh.supabase.co/', true],
    ['http://localhost:54321', true],
    ['https://abcdefgh.supabase.co/rest/v1', false],
    ['https://abcdefgh.supabase.co/rest/v1/', false],
    ['https://abcdefgh.supabase.co/auth/v1', false],
    ['https://abcdefgh.supabase.co/?x=1', false],
    ['http://abcdefgh.supabase.co', false],
    ['not a url', false],
  ])('%s is %s', (url, valid) => {
    expect(checkProjectUrl(url) === null).toBe(valid);
  });

  it('explains which path must be removed', () => {
    expect(checkProjectUrl('https://abcdefgh.supabase.co/rest/v1')).toContain('remove the path "/rest/v1"');
  });

  it('normalises a valid URL to its origin', () => {
    const cfg = readSupabaseConfig({ url: 'https://abcdefgh.supabase.co/', anonKey: KEY });
    expect(cfg).toEqual({ ok: true, url: 'https://abcdefgh.supabase.co', anonKey: KEY });
  });

  it('rejects a URL that already contains an API path', () => {
    const cfg = readSupabaseConfig({ url: 'https://abcdefgh.supabase.co/auth/v1', anonKey: KEY });
    expect(cfg.ok).toBe(false);
  });
});

describe('publishable key validation', () => {
  it('refuses secret keys in the browser', () => {
    expect(readSupabaseConfig({ url: 'https://abcdefgh.supabase.co', anonKey: 'sb_secret_xyz' }).ok).toBe(false);
  });

  it('refuses a service_role JWT', () => {
    const jwt = `${b64url({ alg: 'HS256' })}.${b64url({ role: 'service_role' })}.sig`;
    expect(readSupabaseConfig({ url: 'https://abcdefgh.supabase.co', anonKey: jwt }).ok).toBe(false);
  });

  it('accepts an anon JWT and a publishable key', () => {
    const anon = `${b64url({ alg: 'HS256' })}.${b64url({ role: 'anon' })}.sig`;
    expect(readSupabaseConfig({ url: 'https://abcdefgh.supabase.co', anonKey: anon }).ok).toBe(true);
    expect(readSupabaseConfig({ url: 'https://abcdefgh.supabase.co', anonKey: KEY }).ok).toBe(true);
  });
});

describe('Auth endpoints used by the app', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch() {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'stub' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('sign-in calls exactly <project>/auth/v1/token?grant_type=password with the publishable key', async () => {
    const fetchMock = stubFetch();
    const client = createBrowserClient({ url: 'https://abcdefgh.supabase.co', anonKey: KEY });
    await client.auth.signInWithPassword({ email: 'owner@example.test', password: 'password-123' });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe('https://abcdefgh.supabase.co/auth/v1/token?grant_type=password');
    expect(url).not.toMatch(/\/auth\/v1\/auth\/v1|\/rest\/v1/);
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('apikey')).toBe(KEY);
  });

  it('sign-up calls <project>/auth/v1/signup', async () => {
    const fetchMock = stubFetch();
    const client = createBrowserClient({ url: 'https://abcdefgh.supabase.co', anonKey: KEY });
    await client.auth.signUp({ email: 'new@example.test', password: 'password-123' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://abcdefgh.supabase.co/auth/v1/signup');
  });
});
