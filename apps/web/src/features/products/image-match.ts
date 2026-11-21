import { normalizeSku } from '@erp/domain';

/**
 * Matches image file names to products by SKU. Pure: no browser or database calls, so the rules
 * are unit-tested. The file name without its extension is the SKU: "DEMO-HAMMER.jpg" -> DEMO-HAMMER.
 * Only an exact SKU match is accepted; nothing is guessed.
 */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

export interface ProductRef {
  id: string;
  sku: string;
  hasImage: boolean;
}

export type MatchStatus = 'ready' | 'replace' | 'unmatched' | 'ambiguous' | 'unsupported';

export interface ImageMatch {
  fileName: string;
  sku: string | null;
  productId: string | null;
  status: MatchStatus;
}

export function skuFromFileName(fileName: string): { sku: string; extension: string } {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  return { sku: normalizeSku(stem), extension };
}

export function matchImages(fileNames: readonly string[], products: readonly ProductRef[]): ImageMatch[] {
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const filesPerSku = new Map<string, number>();
  const parsed = fileNames.map((fileName) => ({ fileName, ...skuFromFileName(fileName) }));
  for (const f of parsed) {
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(f.extension) || !f.sku) continue;
    filesPerSku.set(f.sku, (filesPerSku.get(f.sku) ?? 0) + 1);
  }
  return parsed.map(({ fileName, sku, extension }): ImageMatch => {
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(extension) || !sku) {
      return { fileName, sku: sku || null, productId: null, status: 'unsupported' };
    }
    const product = bySku.get(sku);
    if (!product) return { fileName, sku, productId: null, status: 'unmatched' };
    if ((filesPerSku.get(sku) ?? 0) > 1) return { fileName, sku, productId: product.id, status: 'ambiguous' };
    return { fileName, sku, productId: product.id, status: product.hasImage ? 'replace' : 'ready' };
  });
}
