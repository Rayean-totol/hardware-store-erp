import { describe, expect, it } from 'vitest';
import { matchImages, skuFromFileName } from '@/features/products/image-match';

const products = [
  { id: 'p1', sku: 'DEMO-HAMMER', hasImage: false },
  { id: 'p2', sku: 'DEMO-PVC-PIPE', hasImage: true },
  { id: 'p3', sku: 'WS-4X40', hasImage: false },
];

describe('image file names', () => {
  it('takes the SKU from the file name, normalised like SKUs in the database', () => {
    expect(skuFromFileName('demo-hammer.JPG')).toEqual({ sku: 'DEMO-HAMMER', extension: 'jpg' });
    expect(skuFromFileName('ws 4x40.png')).toEqual({ sku: 'WS-4X40', extension: 'png' });
    expect(skuFromFileName('no-extension')).toEqual({ sku: 'NO-EXTENSION', extension: '' });
  });
});

describe('matching images to products', () => {
  it('matches an exact SKU to a product without an image as ready', () => {
    const [m] = matchImages(['DEMO-HAMMER.jpg'], products);
    expect(m).toMatchObject({ sku: 'DEMO-HAMMER', productId: 'p1', status: 'ready' });
  });

  it('marks a product that already has an image as replace (needs confirmation)', () => {
    const [m] = matchImages(['DEMO-PVC-PIPE.png'], products);
    expect(m).toMatchObject({ productId: 'p2', status: 'replace' });
  });

  it('never guesses: a file for an unknown SKU is unmatched, even if the name is close', () => {
    const [m] = matchImages(['DEMO-HAMER.jpg'], products);
    expect(m).toMatchObject({ sku: 'DEMO-HAMER', productId: null, status: 'unmatched' });
  });

  it('marks every file of a SKU that appears twice as ambiguous, so none is uploaded', () => {
    const ms = matchImages(['WS-4X40.jpg', 'ws-4x40.webp'], products);
    expect(ms.map((m) => m.status)).toEqual(['ambiguous', 'ambiguous']);
  });

  it('rejects unsupported file types', () => {
    const [m] = matchImages(['DEMO-HAMMER.gif'], products);
    expect(m?.status).toBe('unsupported');
  });

  it('rejects a file with no name', () => {
    const [m] = matchImages(['.jpg'], products);
    expect(m?.status).toBe('unsupported');
  });
});
