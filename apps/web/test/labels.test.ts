import { describe, expect, it } from 'vitest';
import { renderBarcodeSvg, symbologyFor } from '@/features/labels/barcode-svg';

describe('barcode labels', () => {
  it('picks the GTIN symbology for valid EAN-13 codes and Code 128 otherwise', () => {
    expect(symbologyFor('2000000100012')).toBe('ean13');
    expect(symbologyFor('96385074')).toBe('ean8');
    expect(symbologyFor('SKU-123')).toBe('code128');
    expect(symbologyFor('2000000100013')).toBe('code128');   // wrong check digit: not treated as GTIN
  });

  it('renders SVG for valid codes', () => {
    const svg = renderBarcodeSvg('2000000100012', 'ean13');
    expect(svg).toContain('<svg');
    expect(renderBarcodeSvg('SKU-123', 'code128')).toContain('<svg');
  });

  it('refuses to draw a GTIN with a wrong check digit', () => {
    expect(() => renderBarcodeSvg('2000000100013', 'ean13')).toThrow(/check digit/);
  });
});
