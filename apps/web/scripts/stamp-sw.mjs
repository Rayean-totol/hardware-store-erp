// Runs after `next build`: gives this build's service worker a unique cache name.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', 'out', 'sw.js');
const source = await readFile(file, 'utf8');
if (!source.includes("'__BUILD_ID__'")) {
  throw new Error('sw.js has no __BUILD_ID__ placeholder: refusing to ship an unstamped worker');
}
const id = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
await writeFile(file, source.replace("'__BUILD_ID__'", `'${id}'`));
console.log(`service worker stamped with ${id}`);
