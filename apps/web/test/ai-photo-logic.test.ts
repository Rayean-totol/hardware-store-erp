import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  MONTHLY_CAP_SAR,
  PROVIDER,
  buildGeminiBody,
  checkPhotoRequest,
  monthlyCapSarMicro,
  parseGeminiText,
  validateSuggestion,
  worstCaseCostSarMicro,
  type OrgChoices,
} from '../../../supabase/functions/product-photo-suggest/logic';

const ORG = '00000000-0000-4000-8000-000000000001';
const CAT = '11111111-1111-4111-8111-111111111111';
const UNIT = '22222222-2222-4222-8222-222222222222';
const choices: OrgChoices = {
  categories: [{ id: CAT, nameEn: 'Plumbing' }],
  units: [{ id: UNIT, code: 'pcs' }],
};

describe('budget arithmetic', () => {
  it('reserves a worst-case cost per call in SAR micro-units, rounded up', () => {
    // 1,500 input tokens at $0.10/M + 600 output tokens at $0.40/M = $0.00039, at 3.75 SAR per USD.
    expect(worstCaseCostSarMicro()).toBe(1463);
  });

  it('converts the 10 SAR monthly cap to micro-units', () => {
    expect(MONTHLY_CAP_SAR).toBe(10);
    expect(monthlyCapSarMicro()).toBe(10_000_000);
  });

  it('allows at most about 6,800 worst-case calls a month at the cap', () => {
    const calls = Math.floor(monthlyCapSarMicro() / worstCaseCostSarMicro());
    expect(calls).toBeGreaterThanOrEqual(6_800);
    expect(calls).toBeLessThanOrEqual(6_900);
  });

  it('uses the Flash-Lite model id that the budget was priced for', () => {
    expect(PROVIDER.model).toBe('gemini-2.5-flash-lite');
  });
});

describe('request checks', () => {
  const good = { orgId: ORG, mimeType: 'image/jpeg', imageBase64: 'QUJD' };

  it('accepts a well-formed request', () => {
    expect(checkPhotoRequest(good)).toEqual({ ok: true });
  });

  it('rejects a bad organisation id, mime type, empty image and oversize image', () => {
    expect(checkPhotoRequest({ ...good, orgId: 'not-a-uuid' })).toEqual({ ok: false, reason: 'bad_org' });
    expect(checkPhotoRequest({ ...good, mimeType: 'image/gif' })).toEqual({ ok: false, reason: 'bad_mime' });
    expect(checkPhotoRequest({ ...good, imageBase64: '' })).toEqual({ ok: false, reason: 'empty' });
    const big = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8);
    expect(checkPhotoRequest({ ...good, imageBase64: big })).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('output validation', () => {
  it('keeps the allowed fields and marks the result for review', () => {
    const result = validateSuggestion(
      { nameEn: '  PVC pipe  ', nameAr: 'أنبوب PVC', nameBn: null, categoryId: CAT, unitId: UNIT, description: 'White', confidence: 0.8 },
      choices,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        nameEn: 'PVC pipe',
        nameAr: 'أنبوب PVC',
        nameBn: null,
        categoryId: CAT,
        unitId: UNIT,
        description: 'White',
        confidence: 0.8,
        needsReview: true,
      },
    });
  });

  it('never carries barcode, price, stock or SKU values through', () => {
    const result = validateSuggestion(
      { nameEn: 'Hammer', confidence: 0.9, barcode: '6281234567890', sale_price: 45, purchase_price: 30, stock: 100, sku: 'HAM-1' },
      choices,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = Object.keys(result.value);
    for (const forbidden of ['barcode', 'sale_price', 'purchase_price', 'stock', 'sku']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(result.value)).not.toContain('6281234567890');
  });

  it('drops a category or unit id the organisation does not have', () => {
    const result = validateSuggestion(
      { nameEn: 'Tape', categoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', unitId: 'pcs', confidence: 0.5 },
      choices,
    );
    expect(result.ok && result.value.categoryId).toBeNull();
    expect(result.ok && result.value.unitId).toBeNull();
  });

  it('rejects an answer with no usable name or a non-object', () => {
    expect(validateSuggestion({ nameEn: '   ', confidence: 1 }, choices)).toEqual({ ok: false, reason: 'no_name' });
    expect(validateSuggestion(['x'], choices)).toEqual({ ok: false, reason: 'not_object' });
    expect(validateSuggestion(null, choices)).toEqual({ ok: false, reason: 'not_object' });
  });

  it('limits text length, strips control characters and clamps confidence', () => {
    const result = validateSuggestion(
      { nameEn: 'x'.repeat(500) + '\u0007', description: 'y'.repeat(900), confidence: 7 },
      choices,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nameEn.length).toBe(120);
    expect(result.value.description?.length).toBe(300);
    expect(result.value.confidence).toBe(1);
  });
});

describe('provider request and response', () => {
  it('builds a body with the image, a fixed instruction and a JSON-only response schema', () => {
    const body = buildGeminiBody({ imageBase64: 'QUJD', mimeType: 'image/png', choices });
    const parts = body.contents[0]?.parts ?? [];
    expect(parts[0]).toEqual({ inline_data: { mime_type: 'image/png', data: 'QUJD' } });
    const text = (parts[1] as { text: string } | undefined)?.text ?? '';
    expect(text).toContain('Allowed categories: ' + CAT);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.temperature).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(/api[_-]?key|secret/i);
  });

  it('parses the text of the first candidate and returns null for any other shape', () => {
    const ok = { candidates: [{ content: { parts: [{ text: '{"nameEn":"Nail"}' }] } }] };
    expect(parseGeminiText(ok)).toEqual({ nameEn: 'Nail' });
    expect(parseGeminiText({ candidates: [] })).toBeNull();
    expect(parseGeminiText({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })).toBeNull();
    expect(parseGeminiText(null)).toBeNull();
    expect(parseGeminiText('text')).toBeNull();
  });
});
