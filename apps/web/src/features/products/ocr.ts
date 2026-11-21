// Free, offline OCR in the browser (Tesseract, Apache-2.0). The engine and language files are served
// from this app's own folder (public/ocr, built by scripts/copy-ocr.mjs). No CDN, no API key.
// The engine is loaded only when the user reads a photo, so it does not slow the first page load.
import { BASE_PATH } from '@/lib/base-path';

export interface OcrResult {
  text: string;
  confidence: number;
}

/** Arabic and Bangla models are used together with English, so mixed labels are read. */
const LANGS = 'eng+ara+ben';

export async function readLabel(image: Blob, onProgress?: (progress: number) => void): Promise<OcrResult> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(LANGS, 1, {
    workerPath: `${BASE_PATH}/ocr/worker.min.js`,
    corePath: `${BASE_PATH}/ocr/core/`,
    langPath: `${BASE_PATH}/ocr/lang`,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text, confidence: data.confidence };
  } finally {
    await worker.terminate();
  }
}
