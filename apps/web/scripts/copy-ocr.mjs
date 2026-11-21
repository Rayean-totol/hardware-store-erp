// Copies the free, on-device OCR engine and language data into public/ocr at build time, so the app
// reads them from its own origin (no CDN, no API key, works offline once cached by the browser).
// Output is generated and not committed (see .gitignore).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const tesseractDir = dirname(require.resolve('tesseract.js/package.json'));
const coreDir = dirname(createRequire(join(tesseractDir, 'package.json')).resolve('tesseract.js-core/package.json'));
const out = join(root, 'public', 'ocr');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

// Worker script.
copyFileSync(join(tesseractDir, 'dist', 'worker.min.js'), join(out, 'worker.min.js'));

// LSTM-only engine builds (the language data below is the LSTM model, so the legacy builds are not needed).
let cores = 0;
for (const file of readdirSync(coreDir)) {
  if (file.includes('lstm') && /\.(js|wasm)$/.test(file)) {
    copyFileSync(join(coreDir, file), join(out, 'core', file));
    cores += 1;
  }
}
if (cores === 0) throw new Error('copy-ocr: no LSTM core files found');

// Language data: English, Arabic and Bangla (LSTM "best" integer models, gzipped).
for (const lang of ['eng', 'ara', 'ben']) {
  const src = join(dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0_best_int', `${lang}.traineddata.gz`);
  if (!existsSync(src)) throw new Error(`copy-ocr: missing language data for ${lang}`);
  cpSync(src, join(out, 'lang', `${lang}.traineddata.gz`));
}

console.log(`copy-ocr: ${cores} core files, worker and 3 language files written to public/ocr`);
