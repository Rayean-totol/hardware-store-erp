/** Navigation rules shared by the desktop sidebar, the mobile bottom bar and the More sheet. */

export interface NavEntry {
  key: string;
  href: string;
  show: boolean;
}

/** Fixed order of the mobile bottom bar. "More" is always added after these. */
export const MOBILE_PRIMARY_KEYS = ['dashboard', 'products', 'inventory', 'pos'] as const;

/** Permitted primary tabs, in fixed order. Tabs the user cannot open are left out. */
export function mobilePrimaryTabs<T extends NavEntry>(items: T[]): T[] {
  return MOBILE_PRIMARY_KEYS.flatMap((key) => {
    const entry = items.find((i) => i.key === key && i.show);
    return entry ? [entry] : [];
  });
}

/** True when `pathname` belongs to the entry (matches the section, not just a prefix of another word). */
export function isActiveRoute(pathname: string, href: string): boolean {
  const base = href.replace(/\/$/, '');
  return pathname === base || pathname === `${base}/` || pathname.startsWith(`${base}/`);
}
