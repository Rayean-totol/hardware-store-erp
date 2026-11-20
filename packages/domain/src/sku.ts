/** DB check: ^[A-Z0-9][A-Z0-9._/-]{0,39}$ */
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/;

/** Trim, upper-case and turn whitespace runs into '-' ("ws 4x40" → "WS-4X40"). */
export function normalizeSku(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '-');
}

export function isValidSku(sku: string): boolean {
  return SKU_PATTERN.test(sku);
}
