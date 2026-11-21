/*
 * Cache rules for the service worker. Plain script (no modules) so the service worker can load it
 * with importScripts(). The same file is imported by the unit tests.
 *
 * Only safe static assets are cached: hashed Next.js bundles, the OCR engine and language data, the
 * app icons, manifest and offline page. Everything else goes straight to the network: Supabase and any other origin,
 * API and business data, any request carrying credentials, and all non-GET requests.
 */
/* global module */
(function (root) {
  var PRECACHE = ['offline.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
    'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

  /**
   * @param {{ method: string, url: string, mode?: string, hasAuthorization?: boolean, origin: string, scope: string }} req
   * @returns {'static' | 'navigation' | 'network'}
   */
  function classifyRequest(req) {
    var url;
    try { url = new URL(req.url); } catch { return 'network'; }
    if (req.method !== 'GET') return 'network';
    if (url.origin !== req.origin) return 'network';
    if (req.hasAuthorization) return 'network';
    if (url.pathname.indexOf(req.scope) !== 0) return 'network';
    var rest = url.pathname.slice(req.scope.length);
    if (rest.indexOf('_next/static/') === 0) return 'static';
    // Offline OCR engine and language data (built from installed packages, see scripts/copy-ocr.mjs).
    if (rest.indexOf('ocr/') === 0) return 'static';
    if (PRECACHE.indexOf(rest) !== -1) return 'static';
    if (req.mode === 'navigate') return 'navigation';
    return 'network';
  }

  var api = { PRECACHE: PRECACHE, classifyRequest: classifyRequest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.swRules = api;
})(typeof self !== 'undefined' ? self : globalThis);
