import { DataError } from '@erp/data';

/** Same limit the product photo upload enforces. Larger results are refused, never sent. */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** Tries a large size first, then a smaller one, and returns the first JPEG under the limit. */
const ATTEMPTS: ReadonlyArray<{ maxEdge: number; quality: number }> = [
  { maxEdge: 1600, quality: 0.82 },
  { maxEdge: 1280, quality: 0.7 },
];

/**
 * Resizes and re-encodes a photo as JPEG for upload. Transparent areas become white. Runs in the
 * browser; the original file is not changed and nothing leaves the device until the upload step.
 */
export async function compressForUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const { maxEdge, quality } of ATTEMPTS) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new DataError('image.unsupported', 'canvas');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) throw new DataError('image.unsupported', 'encode');
      if (blob.size <= UPLOAD_MAX_BYTES) return blob;
    }
    throw new DataError('image.too_large', 'after compression');
  } finally {
    bitmap.close();
  }
}
