// Open-model load generator (requests start on schedule whether or not earlier ones finished,
// like real customers). No dependencies: Node's built-in fetch (undici, keep-alive).
// Uses .loadtest/fixtures.json from `pnpm --filter api seed:load`.
//
//   node scripts/loadtest.mjs --base http://localhost:7071 --rps 500 --duration 60
//   node scripts/loadtest.mjs --rps 200 --duration 30 --mix orders     # write-heavy check
//
// The traffic mix follows one customer visit: areas → shop list → shop → price list (often a
// revalidation with If-None-Match) → their account, and a small share placing an order.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--'))
      acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]);
    return acc;
  }, []),
);
const BASE = (args.base ?? 'http://localhost:7071').replace(/\/$/, '');
const RPS = Number(args.rps ?? 200);
const DURATION = Number(args.duration ?? 30);
const MAX_INFLIGHT = Number(args.inflight ?? 4000);
const MIX = args.mix ?? 'visit';
const TIMEOUT_MS = Number(args.timeout ?? 10_000);
const fixtures = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '..', args.fixtures ?? '.loadtest/fixtures.json'),
    'utf8',
  ),
);

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const etags = new Map();

const MIXES = {
  // weights add up to 100
  visit: [
    ['areas', 8],
    ['shops_area', 14],
    ['shops_near', 5],
    ['shop', 18],
    ['items', 22],
    ['items_revalidate', 22],
    ['me', 9],
    ['order', 2],
  ],
  reads: [
    ['shops_area', 25],
    ['shop', 25],
    ['items', 25],
    ['items_revalidate', 25],
  ],
  orders: [
    ['order', 70],
    ['me', 30],
  ],
};
const weights = MIXES[MIX];
if (!weights) throw new Error(`--mix must be one of ${Object.keys(MIXES).join(', ')}`);
const total = weights.reduce((s, [, w]) => s + w, 0);
const chooseKind = () => {
  let r = Math.random() * total;
  for (const [k, w] of weights) if ((r -= w) < 0) return k;
  return weights[0][0];
};

function build(kind) {
  const shop = pick(fixtures.shops);
  const session = pick(fixtures.sessions);
  const auth = { cookie: `pp_session=${session}` };
  switch (kind) {
    case 'areas':
      return { url: '/api/areas' };
    case 'shops_area':
      return { url: `/api/shops?area=${encodeURIComponent(pick(fixtures.areas))}` };
    case 'shops_near':
      return {
        url: `/api/shops?lat=${(17.3 + Math.random() * 0.4).toFixed(4)}&lng=${(78.3 + Math.random() * 0.36).toFixed(4)}`,
      };
    case 'shop':
      return { url: `/api/shops/${shop.code}` };
    case 'items':
      return { url: `/api/shops/${shop.code}/items`, shop: shop.code };
    case 'items_revalidate': {
      const tag = etags.get(shop.code);
      return {
        url: `/api/shops/${shop.code}/items`,
        shop: shop.code,
        headers: tag ? { 'if-none-match': tag } : {},
      };
    }
    case 'me':
      return { url: '/api/me', headers: auth };
    case 'order': {
      const n = 1 + Math.floor(Math.random() * 3);
      const ids = [...shop.items].sort(() => Math.random() - 0.5).slice(0, n);
      return {
        url: '/api/orders',
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json', 'x-pp': '1' },
        body: JSON.stringify({
          shopCode: shop.code,
          lines: ids.map((itemId) => ({ itemId, qty: 1 })),
        }),
      };
    }
  }
  throw new Error(kind);
}

const stats = new Map();
const stat = (k) => {
  if (!stats.has(k)) stats.set(k, { lat: [], codes: {}, errors: 0, bytes: 0 });
  return stats.get(k);
};
let inflight = 0;
let dropped = 0;
let sent = 0;

async function fire(kind) {
  const req = build(kind);
  const s = stat(kind);
  const t0 = performance.now();
  inflight++;
  sent++;
  try {
    const res = await fetch(BASE + req.url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const buf = await res.arrayBuffer();
    s.bytes += buf.byteLength;
    if (req.shop && res.headers.get('etag')) etags.set(req.shop, res.headers.get('etag'));
    s.codes[res.status] = (s.codes[res.status] ?? 0) + 1;
  } catch (e) {
    s.errors++;
    s.codes[e.name === 'TimeoutError' ? 'timeout' : 'network'] =
      (s.codes[e.name === 'TimeoutError' ? 'timeout' : 'network'] ?? 0) + 1;
  } finally {
    s.lat.push(performance.now() - t0);
    inflight--;
  }
}

const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
const ms = (v) => `${v.toFixed(0)}`;

console.log(
  `loadtest: ${RPS} req/s for ${DURATION}s against ${BASE} (mix=${MIX}, ${fixtures.shops.length} shops)`,
);
const startedAt = performance.now();
const end = startedAt + DURATION * 1000;
const pending = new Set();
// Schedule in 10 ms ticks; each tick starts however many requests are due by now.
let due = 0;
await new Promise((done) => {
  const tick = setInterval(() => {
    const now = performance.now();
    if (now >= end) {
      clearInterval(tick);
      done();
      return;
    }
    const target = Math.floor(((now - startedAt) / 1000) * RPS);
    while (due < target) {
      due++;
      if (inflight >= MAX_INFLIGHT) {
        dropped++;
        continue;
      }
      const p = fire(chooseKind());
      pending.add(p);
      p.finally(() => pending.delete(p));
    }
  }, 10);
});
await Promise.allSettled([...pending]);
const elapsed = (performance.now() - startedAt) / 1000;

const rows = [];
let all = [];
let ok = 0;
let bad = 0;
for (const [kind, s] of [...stats].sort()) {
  const sorted = [...s.lat].sort((a, b) => a - b);
  all = all.concat(sorted);
  for (const [code, n] of Object.entries(s.codes)) {
    if (/^(2|3)\d\d$/.test(code)) ok += n;
    else bad += n;
  }
  rows.push({
    kind,
    count: sorted.length,
    p50: ms(pct(sorted, 50)),
    p95: ms(pct(sorted, 95)),
    p99: ms(pct(sorted, 99)),
    max: ms(sorted.at(-1) ?? 0),
    codes: Object.entries(s.codes)
      .map(([c, n]) => `${c}:${n}`)
      .join(' '),
    kbAvg: sorted.length ? (s.bytes / sorted.length / 1024).toFixed(1) : '0',
  });
}
all.sort((a, b) => a - b);
const summary = {
  base: BASE,
  mix: MIX,
  targetRps: RPS,
  durationS: DURATION,
  sent,
  dropped,
  achievedRps: Number((sent / elapsed).toFixed(1)),
  okRate: Number(((ok / Math.max(1, ok + bad)) * 100).toFixed(2)),
  p50: Number(ms(pct(all, 50))),
  p95: Number(ms(pct(all, 95))),
  p99: Number(ms(pct(all, 99))),
  endpoints: rows,
};

console.table(rows);
console.log(
  `sent ${sent} (${summary.achievedRps}/s), dropped ${dropped}, ok ${summary.okRate}%, ` +
    `latency ms p50 ${summary.p50} p95 ${summary.p95} p99 ${summary.p99}`,
);
if (args.out) writeFileSync(args.out, JSON.stringify(summary, null, 2));
