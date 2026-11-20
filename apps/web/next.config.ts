import type { NextConfig } from 'next';

/**
 * Static export: the same `out/` folder is served by the web host and bundled into the
 * Capacitor (Android) and Tauri (Windows) shells in Phase 7. Consequently there are no
 * server components that fetch data, no API routes and no middleware — all data access goes
 * through @erp/data in the browser, secured by Postgres RLS.
 */
// Optional sub-path for hosts that serve the app from a folder, e.g. GitHub Pages at
// https://<owner>.github.io/<repo>/. Leave unset for a root domain or local development.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ['@erp/ui', '@erp/domain', '@erp/i18n', '@erp/data'],
};

export default nextConfig;
