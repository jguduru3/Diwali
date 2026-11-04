// Generates the PNG app icons for both installable apps (customer + merchant) from SVG.
// iOS ignores SVG icons, so PNGs are required for Add to Home Screen.
// Better Analytics design system: Bea stands directly on flat brand blue (customer app);
// the merchant app is ink with a brand-blue shopping-bag badge, so staff tell them apart.
//   node scripts/make-icons.mjs        (output is committed: apps/web/public/icons/)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(import.meta.dirname, '..');
const pub = resolve(root, 'apps/web/public');
const out = resolve(pub, 'icons');
mkdirSync(out, { recursive: true });

const bea = `data:image/png;base64,${readFileSync(resolve(pub, 'bea.png')).toString('base64')}`;

const bg = { customer: '#29a6f2', merchant: '#0f1b26' };

/** Merchant badge: a brand-blue disc with a white shopping bag (drawn at 0,0, 156 px wide). */
const badge = (x, y, scale) => `
  <g transform="translate(${x} ${y}) scale(${scale})">
    <circle cx="78" cy="78" r="78" fill="#0f1b26"/>
    <circle cx="78" cy="78" r="66" fill="#29a6f2"/>
    <path d="M48 66h60l-6 50H54z" fill="#fff"/>
    <path d="M62 68v-9a16 16 0 0 1 32 0v9" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
  </g>`;

function svg(app, { rounded, safe }) {
  // Maskable icons keep content in the central 80 %; Bea is smaller there.
  const size = safe ? 250 : 330;
  const merchant = app === 'merchant';
  const x = merchant && safe ? 112 : (512 - size) / 2;
  const y = merchant ? (safe ? 106 : 70) : (512 - size) / 2 + 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#073a5c" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="${bg[app]}"/>
  <image href="${bea}" xlink:href="${bea}" x="${x}" y="${y}" width="${size}" height="${size}" filter="url(#shadow)"/>
  ${app === 'merchant' ? (safe ? badge(282, 282, 0.62) : badge(330, 330, 1)) : ''}
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

// Android status-bar badge: Bea's silhouette in white on transparent (the system tints it).
const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 96 96">
  <defs><filter id="white"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter></defs>
  <image href="${bea}" xlink:href="${bea}" x="4" y="4" width="88" height="88" filter="url(#white)"/>
</svg>`;
png(badgeSvg, 96, 'badge-96.png');
