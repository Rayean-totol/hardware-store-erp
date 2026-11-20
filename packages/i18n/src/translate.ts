import { ar } from './messages/ar';
import { bn } from './messages/bn';
import { en, type MessageKey, type Messages } from './messages/en';
import type { Locale } from './locales';

export const CATALOGS: Record<Locale, Messages> = { en, ar, bn };

export type Params = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export interface Translator {
  locale: Locale;
  t(key: MessageKey, params?: Params): string;
  /** For computed keys (e.g. `errors.${code}`): returns null when the key does not exist. */
  tMaybe(key: string, params?: Params): string | null;
}

export function createTranslator(locale: Locale): Translator {
  const catalog = CATALOGS[locale];
  return {
    locale,
    t: (key, params) => interpolate(catalog[key] ?? en[key] ?? key, params),
    tMaybe: (key, params) => {
      const template = (catalog as Record<string, string>)[key] ?? (en as Record<string, string>)[key];
      return template === undefined ? null : interpolate(template, params);
    },
  };
}

export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!).sort();
}
