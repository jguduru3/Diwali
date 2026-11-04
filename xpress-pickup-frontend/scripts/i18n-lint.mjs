// i18n lint: every word a person reads must come from i18n/{en,te,hi}.json, so switching to
// Telugu or Hindi replaces it instead of leaving English beside the translation.
// Flags JSX text and user-facing attributes (placeholder, title, alt, aria-label, label) that
// contain English words, and t() calls that carry an English fallback.
// `// i18n-ignore` on a line keeps fixed technical text (legal map attribution, format examples).
//   pnpm i18n-lint
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const webSrc = join(root, 'apps/web/src');

// Names that stay as they are in every language (brands, codes, units).
const ALLOWED = new Set([
  'UPI',
  'QR',
  'OTP',
  'PDF',
  'GST',
  'GSTIN',
  'PhonePe',
  'YouPI-PG',
  'kg',
  'UTR',
  'PAN',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'test'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') && !full.includes('.test.')) out.push(full);
  }
  return out;
}

const words = (text) =>
  (text.match(/[A-Za-z][A-Za-z'’-]{2,}/g) ?? []).filter((w) => !ALLOWED.has(w));

// Text that is code rather than copy: expressions, class strings, arrow bodies.
const looksLikeCode = (text) => /[=;()[\]'"`]|&&|\|\||,$/.test(text) || /^[?:]/.test(text);

const problems = [];
for (const file of walk(webSrc)) {
  const src = readFileSync(file, 'utf8');
  const original = src.split('\n');
  // blank out comments so documentation does not count (line numbers stay the same)
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  code.split('\n').forEach((line, i) => {
    if (original[i]?.includes('i18n-ignore')) return;
    const where = `${relative(root, file).replace(/\\/g, '/')}:${i + 1}`;
    for (const m of line.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)(?=<|\{|$)/g)) {
      // `=>`, `&>` (Tailwind child selectors) and `->` are code, not the end of a tag
      if (['=', '&', '-'].includes(line[m.index - 1])) continue;
      // `Promise<T>`-style generics: an identifier right before the `<…>`
      const text = m[1].trim();
      if (!text || looksLikeCode(text)) continue;
      if (words(text).length) problems.push(`${where}: text "${text.slice(0, 60)}"`);
    }
    for (const m of line.matchAll(/\b(placeholder|title|alt|aria-label|label)="([^"]*)"/g)) {
      if (words(m[2]).length) problems.push(`${where}: ${m[1]}="${m[2]}"`);
    }
    for (const m of line.matchAll(/\bt\(\s*['`][^'`]+['`]\s*,\s*['"`]([^'"`]+)['"`]/g)) {
      problems.push(`${where}: t() fallback "${m[1]}"`);
    }
    for (const m of line.matchAll(/defaultValue:\s*['"`]([^'"`]+)['"`]/g)) {
      problems.push(`${where}: defaultValue "${m[1]}"`);
    }
  });
}

// Every static t('key') must exist in all three catalogues (dynamic keys are checked by the
// i18n test, which compares the three files key by key).
const flat = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
const catalogues = Object.fromEntries(
  ['en', 'te', 'hi'].map((lng) => [
    lng,
    new Set(flat(JSON.parse(readFileSync(join(webSrc, 'i18n', `${lng}.json`), 'utf8')))),
  ]),
);
const hasKey = (set, key) =>
  set.has(key) || ['_one', '_other'].some((suffix) => set.has(`${key}${suffix}`));
for (const file of [...walk(webSrc), ...walkTs(webSrc)]) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) {
    const key = m[1];
    if (key.endsWith('.')) continue;
    for (const [lng, set] of Object.entries(catalogues)) {
      if (!hasKey(set, key)) {
        problems.push(
          `${relative(root, file).replace(/\\/g, '/')}: key "${key}" missing in ${lng}.json`,
        );
      }
    }
  }
}

function walkTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'test'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTs(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts') && !full.includes('.test.'))
      out.push(full);
  }
  return out;
}

if (problems.length) {
  console.error(`i18n lint: ${problems.length} hard-coded string(s); move them to i18n/*.json:\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('i18n lint: no hard-coded copy in the web app.');
