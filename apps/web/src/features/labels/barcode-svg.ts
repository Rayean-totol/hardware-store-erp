import { classifyBarcode, isValidGtin } from '@erp/domain';
import { toSVG } from 'bwip-js';

export type Symbology = 'ean13' | 'ean8' | 'upca' | 'code128';

/** Symbology for a value: EAN-13/EAN-8/UPC-A when the check digit is valid, otherwise Code 128. */
export function symbologyFor(value: string): Symbology {
  const cls = classifyBarcode(value);
  if (cls.kind === 'gtin' && cls.valid) {
    if (cls.length === 13) return 'ean13';
    if (cls.length === 8) return 'ean8';
    if (cls.length === 12) return 'upca';
  }
  return 'code128';
}

/**
 * Renders a barcode as SVG. Throws for values the symbology cannot encode, so the label shows
 * the error instead of a broken barcode.
 */
export function renderBarcodeSvg(value: string, bcid: Symbology): string {
  if (bcid !== 'code128' && !isValidGtin(value)) {
    throw new Error(`invalid ${bcid} check digit`);
  }
  return toSVG({ bcid, text: value, scale: 2, height: 12, includetext: false, paddingwidth: 0, paddingheight: 0 });
}
