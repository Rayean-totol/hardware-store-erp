/** Subpath the app is served from (GitHub Pages: "/hardware-store-erp"), or "" at the domain root. */
export const BASE_PATH: string = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
