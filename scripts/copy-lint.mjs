// G5 copy lint: no "order", "reserve", "cart", "checkout", "delivery", "booking confirmed",
// "buy now" or "100% legal" in any customer- or shop-facing text.
// Checks every i18n catalogue value and every string literal / JSX text in .tsx files.
//   pnpm copy-lint
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const BANNED = [
  'order',
  'orders',
  'ordered',
  'reserve',
  'reserved',
  'reservation',
  'reservations',
  'cart',
  'checkout',
  'buy now',
  'booking confirmed',
  'delivery',
  'deliver',
  'delivered',
  '100% legal',
];
const patterns = BANNED.map((term) => ({
  term,
  re: new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&')}([^a-z]|$)`, 'i'),
}));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Legal references are not commerce words: the mandatory G8 safety notice itself
// says "as per Supreme Court orders".
const ALLOWED_PHRASES = /supreme court order(s)?/gi;

const problems = [];
const check = (file, where, raw) => {
  const text = raw.replace(ALLOWED_PHRASES, '');
  for (const { term, re } of patterns) {
    if (re.test(text))
      problems.push(
        `${relative(root, file)} ${where}: "${term}" in ${JSON.stringify(text.slice(0, 120))}`,
      );
  }
};

const webSrc = join(root, 'apps/web/src');
const files = walk(webSrc);

for (const file of files.filter((f) => /i18n[\\/][a-z]{2}\.json$/.test(f))) {
  const flat = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
    );
  for (const [key, value] of flat(JSON.parse(readFileSync(file, 'utf8'))))
    check(file, key, String(value));
}

for (const file of files.filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(import|export \* from)/.test(line)) return;
    // string literals that look like prose (contain a space) and JSX text between tags
    for (const m of line.matchAll(/(['"`])((?:(?!\1).)*\s(?:(?!\1).)*)\1/g)) {
      if (!/className|class=|https?:/.test(m[2])) check(file, `line ${i + 1}`, m[2]);
    }
    for (const m of line.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g))
      check(file, `line ${i + 1}`, m[1]);
  });
}

if (problems.length) {
  console.error(
    `copy-lint: ${problems.length} banned term(s) found (SPEC §1 G5):\n  ${problems.join('\n  ')}`,
  );
  process.exit(1);
}
console.log(`copy-lint: OK (${files.length} files checked)`);
