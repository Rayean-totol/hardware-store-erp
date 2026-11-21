import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import '../public/sw-rules.js';

// Vitest runs from the web package directory.
const root = path.join(process.cwd(), 'public');
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');
const rules = (globalThis as unknown as { swRules: { classifyRequest: (r: Record<string, unknown>) => string; PRECACHE: string[] } }).swRules;

/** Width and height from the PNG header (bytes 16..23, big-endian). */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(`${root}/${path}`);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('web app manifest', () => {
  const manifest = JSON.parse(read('manifest.webmanifest')) as Record<string, unknown> & {
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  };

  it('has the product name, standalone display and the app colours', () => {
    expect(manifest.name).toBe('Al Qureshi Hardware ERP Pro');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#070d1a');
    expect(manifest.theme_color).toBe('#070d1a');
  });

  it('uses relative start_url and scope so it works under the GitHub Pages subpath', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
  });

  it('declares 192 and 512 icons plus a maskable 512 icon, each present with the right size', () => {
    const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(icon.src)).toEqual({ width: w, height: h });
    }
  });

  it('keeps the maskable icon content inside the 80% safe zone (opaque background at the edges)', () => {
    const bytes = readFileSync(`${root}/icons/icon-maskable-512.png`);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(existsSync(`${root}/icons/apple-touch-icon.png`)).toBe(true);
    expect(pngSize('icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });
});

describe('service worker cache rules', () => {
  const base = { origin: 'https://ex.test', scope: '/hardware-store-erp/' };
  const get = (url: string, extra: Record<string, unknown> = {}) => rules.classifyRequest({ method: 'GET', url: `https://ex.test${url}`, mode: 'no-cors', hasAuthorization: false, ...base, ...extra });

  it('caches hashed Next.js bundles and the icons, manifest and offline page', () => {
    expect(get('/hardware-store-erp/_next/static/chunks/abc123.js')).toBe('static');
    expect(get('/hardware-store-erp/icons/icon-192.png')).toBe('static');
    expect(get('/hardware-store-erp/manifest.webmanifest')).toBe('static');
    expect(get('/hardware-store-erp/offline.html')).toBe('static');
  });

  it('never intercepts another origin, so Supabase data and tokens are never cached', () => {
    expect(get('/rest/v1/stock_levels', { url: 'https://proj.supabase.co/rest/v1/stock_levels' })).toBe('network');
    expect(rules.classifyRequest({ method: 'GET', url: 'https://proj.supabase.co/_next/static/x.js', origin: base.origin, scope: base.scope, mode: 'no-cors' })).toBe('network');
  });

  it('never caches anything carrying credentials or a non-GET request', () => {
    expect(get('/hardware-store-erp/_next/static/chunks/abc.js', { hasAuthorization: true })).toBe('network');
    expect(get('/hardware-store-erp/_next/static/chunks/abc.js', { method: 'POST' })).toBe('network');
    expect(get('/hardware-store-erp/_next/static/chunks/abc.js', { method: 'PUT' })).toBe('network');
  });

  it('treats page navigations as navigation (network first, offline page fallback), never as cacheable assets', () => {
    expect(get('/hardware-store-erp/pos/', { mode: 'navigate' })).toBe('navigation');
    expect(get('/hardware-store-erp/inventory/move/', { mode: 'navigate' })).toBe('navigation');
  });

  it('ignores API-like and out-of-scope paths', () => {
    expect(get('/hardware-store-erp/api/sales')).toBe('network');
    expect(get('/other-app/_next/static/x.js')).toBe('network');
    expect(get('/hardware-store-erp/data.json')).toBe('network');
  });

  it('precaches only the listed safe files', () => {
    expect(rules.PRECACHE).toEqual(expect.arrayContaining(['offline.html', 'manifest.webmanifest']));
    expect(rules.PRECACHE.some((p) => /rest|api|auth/.test(p))).toBe(false);
  });
});

describe('service worker files', () => {
  it('stamps a cache name per build and does not auto-activate a new version', () => {
    const sw = read('sw.js');
    expect(sw).toContain("'__BUILD_ID__'");
    expect(sw).toContain('importScripts');
    const installHandler = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
    expect(installHandler).not.toContain('skipWaiting');
    expect(sw).toContain("SKIP_WAITING");
  });

  it('offline page is self-contained: no external scripts, styles or images', () => {
    const html = read('offline.html');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('You are offline');
    expect(html).toMatch(/lang="ar"/);
  });
});
