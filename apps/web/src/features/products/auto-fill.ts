// Free, rule-based suggestions from label text (OCR output). No network, no AI service.
// Every suggestion is only a proposal: the form shows it for review and nothing is saved from here.

export interface OrgCategory {
  id: string;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
}

export interface OrgUnit {
  id: string;
  code: string;
}

export interface AutoFillSuggestion {
  nameEn: string | null;
  nameAr: string | null;
  nameBn: string | null;
  categoryId: string | null;
  unitId: string | null;
  /** True when the English name was read from the label, so Arabic and Bangla names need a human check. */
  translated: boolean;
}

const LATIN = /[A-Za-z]/g;
const ARABIC = /[؀-ۿ]/g;
const BENGALI = /[ঀ-৿]/g;

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** Non-empty lines with at least three letters of some script. */
export function labelLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => count(l, LATIN) + count(l, ARABIC) + count(l, BENGALI) >= 3);
}

const UNIT_WORDS: { code: string; words: RegExp }[] = [
  { code: 'pcs', words: /\b(pcs|pc|piece|pieces)\b|حبة|قطعة|পিস/i },
  { code: 'box', words: /\b(box|boxes)\b|علبة|بكس|বাক্স/i },
  { code: 'carton', words: /\bcarton\b|كرتون|কার্টন/i },
  { code: 'pack', words: /\b(pack|packet)\b|باكت|প্যাক/i },
  { code: 'bag', words: /\bbags?\b|كيس|ব্যাগ/i },
  { code: 'roll', words: /\broll\b|لفة|রোল/i },
  { code: 'kg', words: /\b(kg|kilo|kilogram)s?\b|كيلو|كيلوغرام|কেজি/i },
];

/** The one unit named on the label, or null when none or more than one is named (ambiguous). */
export function unitCodeFromText(text: string, units: OrgUnit[]): string | null {
  const found = UNIT_WORDS.filter((u) => u.words.test(text)).map((u) => u.code);
  if (found.length !== 1) return null;
  const code = found[0]!;
  return units.some((u) => u.code === code) ? code : null;
}

/** The English product name: the longest latin line that is not only digits or units. */
export function englishNameFromLines(lines: string[]): string | null {
  const candidates = lines
    .filter((l) => count(l, LATIN) >= 4 && count(l, ARABIC) + count(l, BENGALI) === 0)
    .filter((l) => !UNIT_WORDS.some((u) => u.words.test(l) && count(l, LATIN) <= 12));
  if (candidates.length === 0) return null;
  const best = candidates.sort((a, b) => b.length - a.length)[0]!;
  return best.slice(0, 80);
}

export function arabicNameFromLines(lines: string[]): string | null {
  const c = lines.filter((l) => count(l, ARABIC) >= 3 && count(l, LATIN) === 0);
  return c.length ? c.sort((a, b) => b.length - a.length)[0]!.slice(0, 80) : null;
}

export function banglaNameFromLines(lines: string[]): string | null {
  const c = lines.filter((l) => count(l, BENGALI) >= 3 && count(l, LATIN) === 0);
  return c.length ? c.sort((a, b) => b.length - a.length)[0]!.slice(0, 80) : null;
}

/**
 * Common hardware words, English to Arabic and Bangla. A name is translated only when EVERY word
 * is in this list (numbers and size marks pass through). Otherwise the translations stay empty.
 */
export const GLOSSARY: Record<string, { ar: string; bn: string }> = {
  pipe: { ar: 'أنبوب', bn: 'পাইপ' },
  elbow: { ar: 'كوع', bn: 'এলবো' },
  tee: { ar: 'تي', bn: 'টি' },
  valve: { ar: 'صمام', bn: 'ভালভ' },
  screw: { ar: 'برغي', bn: 'স্ক্রু' },
  screws: { ar: 'براغي', bn: 'স্ক্রু' },
  nail: { ar: 'مسمار', bn: 'পেরেক' },
  nails: { ar: 'مسامير', bn: 'পেরেক' },
  bolt: { ar: 'مسمار', bn: 'বোল্ট' },
  nut: { ar: 'صامولة', bn: 'নাট' },
  washer: { ar: 'حلقة', bn: 'ওয়াশার' },
  paint: { ar: 'دهان', bn: 'রং' },
  brush: { ar: 'فرشاة', bn: 'ব্রাশ' },
  roller: { ar: 'رولة', bn: 'রোলার' },
  cable: { ar: 'كابل', bn: 'কেবল' },
  wire: { ar: 'سلك', bn: 'তার' },
  switch: { ar: 'مفتاح', bn: 'সুইচ' },
  socket: { ar: 'مقبس', bn: 'সকেট' },
  bulb: { ar: 'لمبة', bn: 'বাল্ব' },
  hammer: { ar: 'مطرقة', bn: 'হাতুড়ি' },
  saw: { ar: 'منشار', bn: 'করাত' },
  drill: { ar: 'مثقاب', bn: 'ড্রিল' },
  wrench: { ar: 'مفتاح ربط', bn: 'রেঞ্চ' },
  plier: { ar: 'كماشة', bn: 'প্লায়ার' },
  pliers: { ar: 'كماشة', bn: 'প্লায়ার' },
  cement: { ar: 'أسمنت', bn: 'সিমেন্ট' },
  tile: { ar: 'بلاط', bn: 'টাইল' },
  glove: { ar: 'قفاز', bn: 'গ্লাভস' },
  gloves: { ar: 'قفازات', bn: 'গ্লাভস' },
  helmet: { ar: 'خوذة', bn: 'হেলমেট' },
  tape: { ar: 'شريط', bn: 'টেপ' },
  steel: { ar: 'حديد', bn: 'ইস্পাত' },
  iron: { ar: 'حديد', bn: 'লোহা' },
  lock: { ar: 'قفل', bn: 'তালা' },
  hinge: { ar: 'مفصلة', bn: 'কবজা' },
  inch: { ar: 'بوصة', bn: 'ইঞ্চি' },
  pvc: { ar: 'PVC', bn: 'PVC' },
  white: { ar: 'أبيض', bn: 'সাদা' },
  black: { ar: 'أسود', bn: 'কালো' },
  red: { ar: 'أحمر', bn: 'লাল' },
  blue: { ar: 'أزرق', bn: 'নীল' },
  green: { ar: 'أخضر', bn: 'সবুজ' },
  yellow: { ar: 'أصفر', bn: 'হলুদ' },
  heavy: { ar: 'ثقيل', bn: 'ভারী' },
  small: { ar: 'صغير', bn: 'ছোট' },
  large: { ar: 'كبير', bn: 'বড়' },
};

/** Translates an English name word by word. Returns null if any word is unknown. */
export function translateName(nameEn: string): { ar: string; bn: string } | null {
  const words = nameEn.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const ar: string[] = [];
  const bn: string[] = [];
  for (const raw of words) {
    if (/\d/.test(raw)) {
      ar.push(raw);
      bn.push(raw);
      continue;
    }
    const entry = GLOSSARY[raw.toLowerCase().replace(/[^a-z]/g, '')];
    if (!entry) return null;
    ar.push(entry.ar);
    bn.push(entry.bn);
  }
  return { ar: ar.join(' '), bn: bn.join(' ') };
}

/** Category groups: product words that suggest a group, and words that identify the group in the org's list. */
const CATEGORY_GROUPS: { product: RegExp; category: RegExp }[] = [
  { product: /screw|nail|bolt|\bnuts?\b|washer|مسمار|برغي|صامولة|স্ক্রু|পেরেক|বোল্ট/i, category: /fastener|screw|bolt|nut|مثبت|براغي|مسامير|ফাস্টেনার|স্ক্রু|বোল্ট/i },
  { product: /pipe|elbow|\btee\b|valve|fitting|أنبوب|صمام|كوع|পাইপ|ভালভ/i, category: /plumb|pipe|valve|سباك|أنابيب|প্লাম্বিং|পাইপ/i },
  { product: /cable|wire|switch|socket|bulb|سلك|كابل|مفتاح|مقبس|لمبة|সুইচ|সকেট|তার|কেবল|বাল্ব/i, category: /electr|cable|wire|switch|كهرب|كابل|سلك|বৈদ্যুতিক|তার|কেবল|সুইচ/i },
  { product: /paint|brush|roller|دهان|فرشاة|رولة|রং|ব্রাশ/i, category: /paint|دهان|রং/i },
  { product: /hammer|\bsaw\b|plier|wrench|screwdriver|مطرقة|منشار|كماشة|হাতুড়ি|করাত/i, category: /hand tool|tools|عدد يدوية|হাতের|হাত/i },
  { product: /\bdrill|grinder|sander|مثقاب|ড্রিল/i, category: /power tool|عدد كهربائية|পাওয়ার/i },
  { product: /glove|helmet|goggle|قفاز|خوذة|গ্লাভস|হেলমেট/i, category: /safety|سلامة|নিরাপত্তা/i },
  { product: /cement|tile|\bsand\b|brick|أسمنت|بلاط|সিমেন্ট|টাইল/i, category: /building|material|مواد بناء|নির্মাণ/i },
];

/** The one organisation category that matches the label's product group. Null when unclear or ambiguous. */
export function categoryIdFromText(text: string, categories: OrgCategory[]): string | null {
  const hits = CATEGORY_GROUPS.filter((g) => g.product.test(text));
  if (hits.length !== 1) return null;
  const group = hits[0]!;
  const matching = categories.filter((c) =>
    group.category.test(`${c.nameEn} ${c.nameAr} ${c.nameBn ?? ''}`),
  );
  return matching.length === 1 ? matching[0]!.id : null;
}

/** Builds all suggestions from the OCR text. Anything not reliable is left null. */
export function suggestFromLabel(text: string, categories: OrgCategory[], units: OrgUnit[]): AutoFillSuggestion {
  const lines = labelLines(text);
  const nameEn = englishNameFromLines(lines);
  const translation = nameEn ? translateName(nameEn) : null;
  const ownAr = arabicNameFromLines(lines);
  const ownBn = banglaNameFromLines(lines);
  const unitCode = unitCodeFromText(text, units);
  return {
    nameEn,
    nameAr: ownAr ?? (translation?.ar ?? null),
    nameBn: ownBn ?? (translation?.bn ?? null),
    categoryId: categoryIdFromText(text, categories),
    unitId: unitCode ? (units.find((u) => u.code === unitCode)?.id ?? null) : null,
    translated: Boolean(nameEn && !ownAr && !ownBn && translation),
  };
}
