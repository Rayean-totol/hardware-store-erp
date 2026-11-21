// Free, on-device image matching: a difference hash (dHash). No network, no paid service.
// The browser shrinks an image to 9x8 greyscale pixels; neighbouring pixels are compared to make 64 bits.
// Similar photos give hashes that differ in only a few bits.

export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;
export const HASH_BITS = 64;
/** Hamming distance (out of 64) above which two photos are not treated as a match. */
export const MATCH_THRESHOLD = 16;

/** Builds the 64-bit hash (16 hex characters) from 72 greyscale values, row by row, 9 wide and 8 high. */
export function dHashFromGrey(grey: ArrayLike<number>): string {
  if (grey.length !== HASH_WIDTH * HASH_HEIGHT) throw new Error('dhash_bad_size');
  const bits: number[] = [];
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let x = 0; x < HASH_WIDTH - 1; x += 1) {
      const left = grey[y * HASH_WIDTH + x] ?? 0;
      const right = grey[y * HASH_WIDTH + x + 1] ?? 0;
      bits.push(left > right ? 1 : 0);
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] ?? 0) * 8 + (bits[i + 1] ?? 0) * 4 + (bits[i + 2] ?? 0) * 2 + (bits[i + 3] ?? 0);
    hex += nibble.toString(16);
  }
  return hex;
}

/** Number of differing bits between two 16-character hex hashes. Returns HASH_BITS for malformed input. */
export function hammingDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return HASH_BITS;
  let distance = 0;
  for (let i = 0; i < 16; i += 1) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

export interface HashedProduct {
  id: string;
  hash: string;
}

export interface PhotoMatch {
  id: string;
  distance: number;
}

/** Products whose hash is within the threshold, closest first. */
export function rankPhotoMatches(query: string, candidates: HashedProduct[], limit = 5, threshold = MATCH_THRESHOLD): PhotoMatch[] {
  return candidates
    .map((c) => ({ id: c.id, distance: hammingDistance(query, c.hash) }))
    .filter((m) => m.distance <= threshold)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * Browser only: draws an image onto a 9x8 canvas and returns its greyscale values.
 * The image must be same-origin or served with CORS headers, or the canvas cannot be read.
 */
export function greyFromImage(img: CanvasImageSource): number[] {
  const canvas = document.createElement('canvas');
  canvas.width = HASH_WIDTH;
  canvas.height = HASH_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(img, 0, 0, HASH_WIDTH, HASH_HEIGHT);
  const { data } = ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT);
  const grey: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    grey.push(0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0));
  }
  return grey;
}
