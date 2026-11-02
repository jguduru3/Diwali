// Generates the PNG app icons for both installable apps (customer + merchant)
// from SVG. iOS ignores SVG icons, so PNGs are required for Add to Home Screen.
//   node scripts/make-icons.mjs        (output is committed: apps/web/public/icons/)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(import.meta.dirname, '..');
const pub = resolve(root, 'apps/web/public');
const out = resolve(pub, 'icons');
mkdirSync(out, { recursive: true });

const customer = readFileSync(resolve(pub, 'icon.svg'), 'utf8');

/** The diya artwork without its rounded background, to place on other backgrounds. */
const art = customer
  .replace(/<rect[^>]*\/>/, '')
  .replace(/^[\s\S]*?<\/defs>/, '')
  .replace('</svg>', '');
const defs = customer.match(/<defs>[\s\S]*?<\/defs>/)[0];

const bg = {
  customer: ['#2a1745', '#140c24'],
  merchant: ['#0f4c45', '#082623'],
};

/** Merchant badge: a gold shopping bag in the lower right. */
const badge = `
  <g transform="translate(340 330)">
    <circle cx="60" cy="60" r="74" fill="#082623"/>
    <circle cx="60" cy="60" r="62" fill="#f3b941"/>
    <path d="M32 50h56l-5 46H37z" fill="#082623"/>
    <path d="M45 52v-8a15 15 0 0 1 30 0v8" fill="none" stroke="#082623" stroke-width="7" stroke-linecap="round"/>
  </g>`;

function svg(app, { rounded, safe }) {
  const [a, b] = bg[app];
  // Maskable icons must keep content in the central 80 %; scale the artwork down.
  const scale = safe ? 0.78 : 1;
  const shift = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs.replace('<defs>', `<defs><linearGradient id="appbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`)}
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#appbg)"/>
  <g transform="translate(${shift} ${shift}) scale(${scale})">${art}${app === 'merchant' ? badge : ''}</g>
</svg>`;
}

function png(source, size, file) {
  const data = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(out, file), data);
  console.log(`icons/${file}`);
}

for (const app of ['customer', 'merchant']) {
  const rounded = svg(app, { rounded: true, safe: false });
  const square = svg(app, { rounded: false, safe: false });
  const maskable = svg(app, { rounded: false, safe: true });
  writeFileSync(resolve(out, `${app}.svg`), rounded);
  png(rounded, 192, `${app}-192.png`);
  png(rounded, 512, `${app}-512.png`);
  png(maskable, 512, `${app}-maskable-512.png`);
  png(maskable, 192, `${app}-maskable-192.png`);
  // iOS rounds the corners itself and shows transparency as black: full-bleed square.
  png(square, 180, `${app}-apple-180.png`);
  png(rounded, 32, `${app}-32.png`);
}

// Android status-bar badge: a white silhouette on transparent (the system tints it).
const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <path d="M48 10c9 13 14 21 14 29a14 14 0 0 1-28 0c0-8 5-16 14-29z" fill="#fff"/>
  <path d="M12 56h72l-3 4c-4 15-17 24-33 24S19 75 15 60z" fill="#fff"/>
</svg>`;
png(badgeSvg, 96, 'badge-96.png');
