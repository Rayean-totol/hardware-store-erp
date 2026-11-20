import type { NextConfig } from 'next';

/**
 * Static export: the same `out/` folder is served by the web host and bundled into the
 * Capacitor (Android) and Tauri (Windows) shells in Phase 7. Consequently there are no
 * server components that fetch data, no API routes and no middleware — all data access goes
 * through @erp/data in the browser, secured by Postgres RLS.
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ['@erp/ui', '@erp/domain', '@erp/i18n', '@erp/data'],
};

export default nextConfig;
