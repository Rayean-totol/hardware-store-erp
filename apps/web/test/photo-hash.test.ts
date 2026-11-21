import { describe, expect, it } from 'vitest';
import { HASH_BITS, dHashFromGrey, hammingDistance, rankPhotoMatches } from '@/features/products/photo-hash';

// 9x8 greyscale: left-to-right gradient (darker on the left) gives every bit 0 ("left > right" is false).
const rising = Array.from({ length: 72 }, (_, i) => (i % 9) * 10);
// Falling gradient gives every bit 1.
const falling = Array.from({ length: 72 }, (_, i) => 80 - (i % 9) * 10);

describe('dHashFromGrey', () => {
  it('is 16 hex characters and deterministic', () => {
    const h = dHashFromGrey(falling);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(dHashFromGrey(falling)).toBe(h);
  });

  it('sets bits for falling brightness and clears them for rising brightness', () => {
    expect(dHashFromGrey(falling)).toBe('ffffffffffffffff');
    expect(dHashFromGrey(rising)).toBe('0000000000000000');
  });

  it('rejects the wrong number of pixels', () => {
    expect(() => dHashFromGrey([1, 2, 3])).toThrow('dhash_bad_size');
  });

  it('is unchanged by a uniform brightness shift (same gradient, brighter)', () => {
    const brighter = falling.map((v) => v + 40);
    expect(dHashFromGrey(brighter)).toBe(dHashFromGrey(falling));
  });
});

describe('hammingDistance', () => {
  it('counts differing bits', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(HASH_BITS);
    expect(hammingDistance('0000000000000001', '0000000000000000')).toBe(1);
    expect(hammingDistance('f0', 'f0')).toBe(HASH_BITS);
  });
});

describe('rankPhotoMatches', () => {
  const candidates = [
    { id: 'far', hash: 'ffffffffffffffff' },
    { id: 'near', hash: '0000000000000003' },
    { id: 'same', hash: '0000000000000000' },
  ];

  it('returns the closest products first and drops those beyond the threshold', () => {
    const matches = rankPhotoMatches('0000000000000000', candidates, 5, 16);
    expect(matches).toEqual([
      { id: 'same', distance: 0 },
      { id: 'near', distance: 2 },
    ]);
  });

  it('limits the number of results', () => {
    expect(rankPhotoMatches('0000000000000000', candidates, 1, 64)).toHaveLength(1);
  });
});
