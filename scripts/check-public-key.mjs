// Refuses to build a frontend with a key that must never reach a browser.
// Accepts only the publishable/anon key. Usage: node scripts/check-public-key.mjs <key>
const key = process.argv[2] ?? '';
const fail = (why) => {
  console.error(`REFUSED: ${why}. Use the publishable key from Supabase Project Settings → API.`);
  process.exit(1);
};
if (!key) fail('NEXT_PUBLIC_SUPABASE_ANON_KEY is empty');
if (key.startsWith('sb_secret_')) fail('a secret key (sb_secret_) was supplied');
if (key.split('.').length === 3) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (payload.role === 'service_role') fail('a service_role JWT was supplied');
  } catch {
    // not a JWT payload we can read: treated as an opaque publishable key
  }
}
console.log('public key check passed');
