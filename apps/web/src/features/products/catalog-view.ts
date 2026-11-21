/**
 * Pure helpers for the product catalogue screen (no React, no I/O), so they can be unit tested.
 */

export type ProductView = 'grid' | 'list';

/** Per-device preference key. Stored in localStorage through writePref/readPref. */
export const PRODUCT_VIEW_PREF = 'erp.products.view';

/** Unknown or missing values fall back to the grid, the default catalogue layout. */
export function parseProductView(raw: string | null | undefined): ProductView {
  return raw === 'list' ? 'list' : 'grid';
}

/**
 * Placeholder family shown when a product has no photo. Only icons are shown, never
 * stock photos, so an image is never presented as the real product.
 */
export type PlaceholderKind = 'safety' | 'tools' | 'electrical' | 'plumbing' | 'paint' | 'fasteners' | 'building' | 'general';

/**
 * Keyword rules on the English category name. Order matters: the first match wins, so
 * "Measuring Tape" (tools) is not treated as a tap (plumbing).
 */
const PLACEHOLDER_RULES: ReadonlyArray<readonly [PlaceholderKind, readonly string[]]> = [
  ['safety', ['safety', 'ppe', 'glove', 'helmet', 'goggle', 'mask', 'vest', 'boot']],
  ['tools', ['tool', 'hammer', 'drill', 'grinder', 'wrench', 'saw', 'spanner', 'plier', 'screwdriver', 'tape']],
  ['electrical', ['electric', 'led', 'bulb', 'cable', 'wire', 'switch', 'socket', 'breaker', 'lamp', 'light']],
  ['plumbing', ['plumb', 'pipe', 'tap', 'valve', 'fitting', 'water', 'drain', 'hose']],
  ['paint', ['paint', 'primer', 'varnish', 'chemical', 'thinner', 'adhesive', 'sealant']],
  ['fasteners', ['fastener', 'screw', 'nail', 'bolt', 'anchor', 'washer', 'rivet']],
  ['building', ['building', 'cement', 'sand', 'brick', 'block', 'tile', 'steel', 'rebar', 'concrete', 'plaster']],
];

export function placeholderKindFor(categoryNameEn: string | null | undefined): PlaceholderKind {
  const text = (categoryNameEn ?? '').toLowerCase();
  if (!text) return 'general';
  for (const [kind, words] of PLACEHOLDER_RULES) {
    if (words.some((w) => text.includes(w))) return kind;
  }
  return 'general';
}

/**
 * Stock status label keys, used only when a real quantity is known. Status is "active" or
 * "archived" until the product list is connected to live stock levels.
 */
export type ProductStatusKey = 'common.active' | 'common.archived';

export function productStatusKey(archivedAt: string | null): ProductStatusKey {
  return archivedAt ? 'common.archived' : 'common.active';
}
