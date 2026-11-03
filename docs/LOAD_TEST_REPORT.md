# Load test report — season peak (3,000 merchants × 1,000 customers a minute)

Date: 3 November 2026. Code: this release (sale modes, documents, catalogue caching).

## Target

3,000 merchants, each with 1,000 customers a minute at peak = **3,000,000 requests a minute ≈
50,000 requests a second**, sustained.

## What was measured, and what was not

|              |                                                                                                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Measured     | The real API code (same handlers, `route()` wrapper and SQL) against PostgreSQL 16 holding **3,000 listed merchants, 45,000 products, 3,000 customers** (`pnpm --filter api seed:load`)                                           |
| Machine      | One laptop: Intel i5-6300U, 4 cores (2015), 17 GB RAM. API (3 workers), PostgreSQL and the load generator all on it                                                                                                               |
| Not measured | 50,000 req/s. One laptop cannot generate or serve that; it needs the deployed stack (Front Door + Functions + Flexible Server) and distributed load generators. `loadtest/k6-peak.js` is the ready script for that run on staging |

The local Azure Functions emulator (`func start`) is a debugging host: it topped out near
40–50 req/s here with every request logged to the console. The numbers below come from
`pnpm --filter api bench:serve`, which serves the same handlers from a plain Node HTTP server
(one worker per core, like Function instances).

## Results on the laptop

**Customer visit mix** (`node scripts/loadtest.mjs --mix visit`): areas 8%, shop list by area
14%, near me 5%, shop page 18%, price list 44% (half of them revalidations with `If-None-Match`),
`/me` 9%, place an order 2%. Open model: requests start on schedule like real customers.

| Rate            | Success   | p50   | p95   | p99    | Notes                                        |
| --------------- | --------- | ----- | ----- | ------ | -------------------------------------------- |
| 250 req/s, 30 s | 100%      | 7 ms  | 46 ms | 282 ms | 144 orders placed, order p95 169 ms          |
| 500 req/s, 30 s | 99.5%     | 15 ms | 1.8 s | 2.9 s  | laptop CPU saturated; 0.5% connection errors |
| 750+ req/s      | collapses | —     | —     | —      | generator and server share 4 cores           |

**Throughput per endpoint** (closed loop, 30–100 connections, no errors):

| Request                                                                | req/s                           | p50      | p95        |
| ---------------------------------------------------------------------- | ------------------------------- | -------- | ---------- |
| Areas (cache hit)                                                      | 1,817                           | 23 ms    | 56 ms      |
| Shop page (cache hit)                                                  | 2,399                           | 16 ms    | 36 ms      |
| Price list (cache hit)                                                 | 1,975                           | 21 ms    | 42 ms      |
| Shop list for an area (≈100 shops)                                     | 963                             | 45 ms    | 62 ms      |
| Price list, **every request a different shop** (cache miss, 4 queries) | 512–809                         | 67–78 ms | 107–369 ms |
| Shop page, every request a different shop                              | 842                             | 49 ms    | 66 ms      |
| Place an order (server pricing, stock, ₹30 fee checkout)               | ≈ 70 sustained, saturates ≈ 100 | 30 ms    | 96 ms      |

## Changes made because of these tests

1. **In-instance cache for the public catalogue** (`apps/api/src/lib/cache.ts`): the shop list,
   areas, shop pages, price lists and the category list are built once per instance per
   `CATALOGUE_CACHE_SECONDS` (default 10, prod 15), with one load shared by concurrent callers.
   Ordering never reads from it: `placeOrder` re-checks listing, prices and stock (G6, G11).
2. **Edge caching at Front Door** (`infra/main.bicep`, route `catalogue`): `/api/areas`,
   `/api/shops`, `/api/shops/*` are served from the edge for the seconds the API allows, with
   gzip. Everything else under `/api` stays uncached, and the API now marks any response that
   sets no caching as `Cache-Control: no-store` (tested).
3. **"Near me" returns the 200 nearest shops** instead of all of them: 906 KB → 62 KB per request.
4. **Home page renders shops 24 at a time** ("Show more"); the map still shows every shop.
5. **Capacity is a deployment parameter**: Postgres SKU, tier, HA and storage; Function
   instances; connections per instance (`DB_POOL_MAX`); PgBouncer is switched on automatically
   for General Purpose and above, and the app connects through it (port 6432).

## Capacity plan for 50,000 req/s

| Traffic                                                   | Share | req/s    | Served by                                                                                                                                                                         |
| --------------------------------------------------------- | ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue (areas, lists by area, shop pages, price lists) | 84%   | ≈ 42,000 | Front Door edge. About 6,000 distinct URLs (3,000 shops × page + price list); with a 15 s TTL the origin sees ≈ 400 req/s per edge location, mostly answered from instance memory |
| Near me (personal, not shared)                            | 5%    | ≈ 2,500  | Function instances, from instance memory (no database)                                                                                                                            |
| `/me`                                                     | 9%    | ≈ 4,500  | Function instances, 2 small indexed queries each                                                                                                                                  |
| Orders                                                    | 2%    | ≈ 1,000  | Function instances + database transactions                                                                                                                                        |

Origin total ≈ 10,000–12,000 req/s. At the laptop's cache-miss rate per core (≈ 250 req/s per
worker) a 1-vCPU Flex Consumption instance handles roughly 300–600 req/s of this mix, so about
**20–40 instances** at peak. `params.prod.json` allows 200.

Database: `Standard_D8ds_v5` (8 vCores, General Purpose, zone-redundant HA) with PgBouncer in
transaction mode, 10 connections per instance. **1,000 orders a second is the limit to prove on
staging.** The laptop sustained about 70–100 orders/s with the database sharing 4 old cores
with everything else. Note that 1,000 orders/s is 3.6 million orders an hour, far more than
3,000 shops' packers can pack (a packer handles tens an hour). The real order rate will be
bounded by that, and by the ₹30 fee provider's API limits, long before the database.

## Run the real test (staging)

1. Deploy staging with `params.prod.json` sizing (or a copy with `env: dev`).
2. Seed it: `DATABASE_URL=<staging> pnpm --filter api seed:load -- --shops 3000 --customers 20000`.
   This writes `.loadtest/fixtures.json`, which holds session tokens for test customers only.
3. `k6 cloud run -e BASE=https://<staging-host> -e RATE=50000 loadtest/k6-peak.js` (or Azure Load
   Testing with the same script). It ramps up for 5 minutes, holds the peak for 10, and fails if
   more than 1% of requests error or the catalogue p95 exceeds 300 ms.
4. Watch Function instance count, PgBouncer client and server connections, Postgres CPU, and the
   Front Door cache hit ratio (aim for more than 90% on the catalogue route).

Never run it against production: it places orders and needs the mock fee provider, which
production refuses.

## Reproduce the local numbers

```bash
pnpm db:embedded            # keep running
pnpm db:migrate && pnpm db:seed
pnpm --filter api seed:load -- --shops 3000 --items 15 --customers 3000
DB_POOL_MAX=10 pnpm --filter api bench:serve -- --port 7090 --workers 3
node scripts/loadtest.mjs --base http://localhost:7090 --rps 250 --duration 30
```
