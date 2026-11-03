// Season-peak load test for a deployed environment (staging), run from k6 cloud runners or
// Azure Load Testing — one laptop cannot generate this. Same traffic mix as scripts/loadtest.mjs.
//
// Target: 3,000 merchants × 1,000 customers a minute = 3,000,000 requests/min ≈ 50,000 req/s.
//
//   pnpm --filter api seed:load -- --shops 3000 --customers 20000   # against the STAGING database
//   k6 run -e BASE=https://<staging-host> -e RATE=50000 loadtest/k6-peak.js
//   k6 cloud run -e BASE=... loadtest/k6-peak.js                     # distributed
//
// Never point it at production: it places real orders (ordering must be enabled on staging,
// with the mock fee provider, which production refuses).
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE;
const RATE = Number(__ENV.RATE || 50000);
const fixtures = new SharedArray('fixtures', () => [
  JSON.parse(open('../.loadtest/fixtures.json')),
]);

export const options = {
  discardResponseBodies: true,
  scenarios: {
    peak: {
      executor: 'ramping-arrival-rate',
      startRate: Math.round(RATE / 20),
      timeUnit: '1s',
      preAllocatedVUs: Math.round(RATE / 10),
      maxVUs: Math.round(RATE / 2),
      stages: [
        { target: Math.round(RATE / 2), duration: '3m' }, // warm-up: instances scale out
        { target: RATE, duration: '2m' },
        { target: RATE, duration: '10m' }, // sustained peak
        { target: 0, duration: '1m' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:catalogue}': ['p(95)<300', 'p(99)<800'],
    'http_req_duration{kind:account}': ['p(95)<500'],
    'http_req_duration{kind:order}': ['p(95)<1000'],
  },
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const etags = {};

export default function () {
  const f = fixtures[0];
  const shop = pick(f.shops);
  const cookie = { cookie: `pp_session=${pick(f.sessions)}` };
  const r = Math.random() * 100;
  let res;
  if (r < 8) res = http.get(`${BASE}/api/areas`, { tags: { kind: 'catalogue' } });
  else if (r < 22)
    res = http.get(`${BASE}/api/shops?area=${encodeURIComponent(pick(f.areas))}`, {
      tags: { kind: 'catalogue' },
    });
  else if (r < 27)
    res = http.get(
      `${BASE}/api/shops?lat=${(17.3 + Math.random() * 0.4).toFixed(4)}&lng=${(78.3 + Math.random() * 0.36).toFixed(4)}`,
      { tags: { kind: 'account' } },
    );
  else if (r < 45)
    res = http.get(`${BASE}/api/shops/${shop.code}`, { tags: { kind: 'catalogue' } });
  else if (r < 89) {
    const headers = etags[shop.code] && r >= 67 ? { 'if-none-match': etags[shop.code] } : {};
    res = http.get(`${BASE}/api/shops/${shop.code}/items`, {
      headers,
      tags: { kind: 'catalogue' },
    });
    if (res.headers.Etag) etags[shop.code] = res.headers.Etag;
  } else if (r < 98)
    res = http.get(`${BASE}/api/me`, { headers: cookie, tags: { kind: 'account' } });
  else {
    const lines = [...shop.items]
      .sort(() => Math.random() - 0.5)
      .slice(0, 1 + Math.floor(Math.random() * 3))
      .map((itemId) => ({ itemId, qty: 1 }));
    res = http.post(`${BASE}/api/orders`, JSON.stringify({ shopCode: shop.code, lines }), {
      headers: { ...cookie, 'content-type': 'application/json', 'x-pp': '1' },
      tags: { kind: 'order' },
    });
  }
  check(res, { ok: (x) => x.status < 400 || x.status === 429 });
}
