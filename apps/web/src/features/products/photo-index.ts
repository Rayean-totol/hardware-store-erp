// Shared, on-device photo hashing used by "Find by photo" and the New Product photo panel.
// Nothing leaves the browser. Hashes are kept in memory for this session only.
import { type HashedProduct, dHashFromGrey, greyFromImage } from './photo-hash';

const hashCache = new Map<string, string>();
const WORKERS = 4;

async function hashImageSource(src: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return dHashFromGrey(greyFromImage(img));
}

/** Hash of a photo the user just picked or took. */
export async function hashPhotoFile(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return dHashFromGrey(greyFromImage(bitmap));
  } finally {
    bitmap.close();
  }
}

/**
 * Hashes stored product photos. Products whose photo cannot be read are skipped, not failed.
 * `signedUrl` is the existing storage service, so access rules still apply.
 */
export async function hashProductPhotos(
  items: { id: string; imagePath: string }[],
  signedUrl: (path: string) => Promise<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<HashedProduct[]> {
  const hashed: HashedProduct[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        let hash = hashCache.get(item.imagePath);
        if (!hash) {
          hash = await hashImageSource(await signedUrl(item.imagePath));
          hashCache.set(item.imagePath, hash);
        }
        hashed.push({ id: item.id, hash });
      } catch {
        // Skipped: one unreadable photo does not stop the search.
      }
      done += 1;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, items.length) }, () => worker()));
  return hashed;
}
