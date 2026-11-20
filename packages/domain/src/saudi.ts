/**
 * FORMAT checks for Saudi identifiers. They do not prove a number is registered —
 * that requires checking with ZATCA / the Ministry of Commerce.
 */

/** VAT registration number: 15 digits, first and last digit 3. */
export function isValidVatNumberFormat(value: string): boolean {
  return /^3\d{13}3$/.test(value);
}

/** Commercial Registration number: 10 digits. */
export function isValidCrNumberFormat(value: string): boolean {
  return /^\d{10}$/.test(value);
}

/** National address building number / additional number: 4 digits. */
export function isValidBuildingNumber(value: string): boolean {
  return /^\d{4}$/.test(value);
}

/** National address postal code: 5 digits. */
export function isValidPostalCode(value: string): boolean {
  return /^\d{5}$/.test(value);
}

const ARABIC_LETTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;

export function containsArabic(value: string): boolean {
  return ARABIC_LETTER.test(value);
}
