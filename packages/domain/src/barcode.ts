/** Characters allowed in a barcode (DB check: ^[0-9A-Za-z./+-]{1,48}$). */
export const BARCODE_PATTERN = /^[0-9A-Za-z./+-]{1,48}$/;

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/** GS1 mod-10 check digit for the digits *without* the check digit. */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new RangeError('GTIN body must be digits');
  let sum = 0;
  // Weights alternate 3,1,3,… starting from the rightmost body digit.
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || !GTIN_LENGTHS.has(code.length)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

export type BarcodeClass =
  | { kind: 'gtin'; valid: boolean; length: number }
  | { kind: 'internal' }
  | { kind: 'invalid' };

/**
 * Numeric codes of GTIN length (8/12/13/14) are treated as GTINs and must carry a valid
 * check digit — a mistyped digit is the most common scanning/data-entry error. Anything else
 * matching BARCODE_PATTERN is accepted as an internal (e.g. Code 128) code.
 */
export function classifyBarcode(code: string): BarcodeClass {
  if (!BARCODE_PATTERN.test(code)) return { kind: 'invalid' };
  if (/^\d+$/.test(code) && GTIN_LENGTHS.has(code.length)) {
    return { kind: 'gtin', valid: isValidGtin(code), length: code.length };
  }
  return { kind: 'internal' };
}

/**
 * In-store EAN-13 in the GS1 restricted-circulation range (prefix 20–29), for items without a
 * manufacturer barcode. `sequence` must be unique per organization (Phase 2 allocates it from a
 * per-org counter; Phase 1 UI picks max+1 and the DB unique index catches races).
 */
export function generateInStoreEan13(sequence: number, prefix = '20'): string {
  if (!/^2\d$/.test(prefix)) throw new RangeError('Restricted-circulation prefix must be 20–29');
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 9_999_999_999) {
    throw new RangeError('Sequence out of range');
  }
  const body = prefix + String(sequence).padStart(10, '0');
  return body + String(gtinCheckDigit(body));
}
