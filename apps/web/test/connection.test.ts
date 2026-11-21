import { describe, expect, it, vi } from 'vitest';
import { checkServer, deriveConnection, initialConnection, reduceConnection, writesAllowed } from '@/lib/connection';
import { connectionGate } from '@/lib/connection-gate';

describe('connection state', () => {
  it('starts reconnecting: writes stay off until the server answers', () => {
    expect(deriveConnection(initialConnection)).toBe('reconnecting');
    expect(writesAllowed(deriveConnection(initialConnection))).toBe(false);
  });

  it('a successful server check makes the app online and writable', () => {
    const s = reduceConnection(initialConnection, { type: 'check', reachable: true });
    expect(deriveConnection(s)).toBe('online');
    expect(writesAllowed(deriveConnection(s))).toBe(true);
  });

  it('the browser going offline is offline, whatever the last server check said', () => {
    const online = reduceConnection(initialConnection, { type: 'check', reachable: true });
    const offline = reduceConnection(online, { type: 'browser', online: false });
    expect(deriveConnection(offline)).toBe('offline');
  });

  it('coming back online is reconnecting again until the server is checked', () => {
    const offline = reduceConnection(initialConnection, { type: 'browser', online: false });
    const back = reduceConnection(offline, { type: 'browser', online: true });
    expect(deriveConnection(back)).toBe('reconnecting');
    expect(deriveConnection(reduceConnection(back, { type: 'check', reachable: false }))).toBe('offline');
  });

  it('an unchanged browser event keeps the previous server result', () => {
    const online = reduceConnection(initialConnection, { type: 'check', reachable: true });
    expect(reduceConnection(online, { type: 'browser', online: true })).toBe(online);
  });
});

describe('server health check', () => {
  it('uses the Supabase health endpoint with the public key, never a token', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await checkServer('https://proj.supabase.co/', 'anon-key', fetchFn as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/auth/v1/health');
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key');
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
    expect(init.cache).toBe('no-store');
  });

  it('treats an error status, a network failure and a timeout as not reachable', async () => {
    expect(await checkServer('https://x.supabase.co', 'k', (async () => new Response('', { status: 503 })) as typeof fetch)).toBe(false);
    expect(await checkServer('https://x.supabase.co', 'k', (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch)).toBe(false);
    const hangs = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
    expect(await checkServer('https://x.supabase.co', 'k', hangs, 20)).toBe(false);
  });
});

describe('write gate', () => {
  it('notifies listeners only when the value changes, and starts closed', () => {
    connectionGate.set(false);
    expect(connectionGate.isOpen()).toBe(false);
    const seen: boolean[] = [];
    const off = connectionGate.subscribe((open) => seen.push(open));
    connectionGate.set(true);
    connectionGate.set(true);
    connectionGate.set(false);
    off();
    expect(seen).toEqual([true, false]);
  });
});
