import { LOCALE_INFO, type Locale, type NumberingSystem } from './locales';

/** Intl numeric input: strings keep full decimal precision (Intl.NumberFormat v3). */
type NumericInput = string | number;

export interface Formatters {
  number(value: NumericInput, maxFractionDigits?: number): string;
  /** Money in SAR with exactly 2 decimals. */
  money(value: NumericInput): string;
  date(value: string | Date): string;
  dateTime(value: string | Date): string;
}

export function intlLocaleTag(locale: Locale, numbering?: NumberingSystem): string {
  const info = LOCALE_INFO[locale];
  return `${info.intl}-u-nu-${numbering ?? info.defaultNumbering}`;
}

export function createFormatters(locale: Locale, numbering?: NumberingSystem): Formatters {
  const tag = intlLocaleTag(locale, numbering);
  const money = new Intl.NumberFormat(tag, {
    style: 'currency',
    currency: 'SAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dateFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium' });
  const dateTimeFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' });
  const numberFmts = new Map<number, Intl.NumberFormat>();

  // Intl.NumberFormat#format accepts decimal strings at runtime (ES2023), but the
  // TS lib types only allow number | bigint, hence the cast.
  const fmt = (f: Intl.NumberFormat, v: NumericInput) => f.format(v as unknown as number);

  return {
    number(value, maxFractionDigits = 6) {
      let f = numberFmts.get(maxFractionDigits);
      if (!f) {
        f = new Intl.NumberFormat(tag, { maximumFractionDigits: maxFractionDigits });
        numberFmts.set(maxFractionDigits, f);
      }
      return fmt(f, value);
    },
    money: (value) => fmt(money, value),
    date: (value) => dateFmt.format(typeof value === 'string' ? new Date(value) : value),
    dateTime: (value) => dateTimeFmt.format(typeof value === 'string' ? new Date(value) : value),
  };
}
