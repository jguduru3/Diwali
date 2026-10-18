# Pataka Pickup — Master Build Guide for Claude Code

**Version:** 1.0 · 14 Oct 2026 · Owner: Truerenewables (care@truerenewables.in)
**Target:** Diwali pilot live **29 Oct 2026**, Diwali **8 Nov 2026**, Hyderabad
**Deploy:** Azure — Blob Storage static website (frontend) + Azure Functions (API) + Azure Database for PostgreSQL Flexible Server

---

## 0. How to use this file

1. Create an empty Git repo, e.g. `pataka-pickup`.
2. Save this file as `docs/SPEC.md`.
3. Copy section 16 ("CLAUDE.md") into the repo root as `CLAUDE.md`.
4. Open Claude Code in the repo and run the phases in order (section 14). Example first prompt:

   > Read `CLAUDE.md` and `docs/SPEC.md` fully. Then execute **Phase 0** only. Stop when its acceptance criteria pass and show me the results.

5. Run one phase per session. Review, commit, then start the next phase.

**Rule for Claude Code:** this spec wins over your own preferences. If something is unclear or conflicts, stop and ask; do not invent behaviour that touches the legal guardrails in section 1.

---

## 1. Product in one paragraph + legal guardrails (NON-NEGOTIABLE)

Pataka Pickup is a **shop finder, price list and drive-through queue** for licensed cracker shops in Hyderabad. Customers browse green-cracker price lists, build a **plan list that stays on their own phone**, and book a **time slot** (a queue token). At the shop cluster they park in a holding bay, a marshal scans their slot QR, and the shop counter scans their list QR to produce a bill instantly. **All ordering, packing, billing and payment happen at the licensed counter.** The platform never sells, stores, carries, delivers crackers or handles money.

Why: Supreme Court orders (Arjun Gopal v. UoI, 23 Oct 2018 para 42(v); 29 Oct 2021 para 48.5) say *"No e-commerce websites … shall accept any online orders and effect online sales."* The architecture below is designed so the platform never accepts an order.

These rules are enforced in code and tests. Breaking any of them is a release blocker:

| # | Guardrail | How it is enforced |
|---|---|---|
| G1 | The server **never stores or transmits item lists** tied to a user or booking. The plan list lives only in the browser (localStorage) and in the QR code. | No `booking_items` / `order_items` table. API schema has no items field on bookings. A test greps migrations and API schemas for `order_items`, `cart`, `booking_items`. |
| G2 | **Shops never receive a list before the customer is at the counter.** The list reaches the shop only by scanning the customer's QR on site. | Counter decoding happens client-side in the shop app; no endpoint accepts a list. |
| G3 | **No online payment**, no payment gateway SDK, no UPI intent links, no wallets. | Dependency deny-list test (`razorpay`, `stripe`, `paytm`, `phonepe`, `cashfree`, `payu`, `upi://`). |
| G4 | **No commission or per-sale fees.** The platform does not record sale amounts. | No `amount`/`total` columns on bookings. "Served" is a status only. |
| G5 | **Wording:** never use "order", "reserve", "reservation", "cart", "checkout", "buy now", "booking confirmed", "100% legal", "delivery" in customer- or shop-facing copy. Use "plan list", "slot", "visit", "pickup slot", "prices final at the counter". | Copy-lint test over `apps/web/src/i18n/*.json` and all `.tsx` string literals. |
| G6 | **Only verified, in-date licensed shops are visible.** A shop disappears automatically when its licence expires or is unverified. | SQL view `visible_shops` used by every public query. |
| G7 | **Green crackers only.** Every item must carry a green-certification type and reference. Banned categories (joined/series/"lari", barium) cannot be created. | DB `CHECK` + category `is_banned` flag + API validation. |
| G8 | Safety notice on every ticket: *"Green crackers only. Burst only between 8 pm and 10 pm on Diwali, as per Supreme Court orders. Keep children supervised."* | Ticket component snapshot test. |
| G9 | **Minimal personal data (DPDP Act 2023):** phone number only, explicit consent screen, purge 90 days after season end, self-service delete. | `consents` table, purge job, `DELETE /api/me`. |

---

## 2. Users and apps

One React PWA with four route areas (role-gated). No native app; it installs from the browser on Android and iOS.

| Area | Route | Users | Core jobs |
|---|---|---|---|
| Customer | `/` | Public; phone OTP only when booking a slot | Pick area → see shops → view price list → build plan list → book slot → show ticket QR → cancel |
| Shop | `/shop` | Shop owner, counter staff | Edit price list, toggle sold-out, set slot capacity, see today's slots, **scan list QR → pick list + bill**, mark served/no-show |
| Gate | `/gate` | Cluster marshal | Scan slot QR → validate → assign bay → mark arrived |
| Admin | `/admin` | Truerenewables team | Onboard clusters & shops, verify licences, manage categories, view metrics, block numbers |

Languages: **English and Telugu** (i18next), Hindi optional later. Shop/gate apps must be usable one-handed, large tap targets (≥ 48 px), high contrast for outdoor night use.

---

## 3. Architecture

```
                 ┌──────────────────────── Azure Front Door (Standard) ────────────────────────┐
 Browser/PWA ──► │  pickup.<domain>   /*  → Storage static website ($web)                       │
                 │                    /api/* → Azure Functions (Node 20, TypeScript)            │
                 └──────────────────────────────────────────────────────────────────────────────┘
                                                   │
                     ┌─────────────────────────────┼─────────────────────────────┐
                     ▼                             ▼                             ▼
     PostgreSQL Flexible Server         Storage account (private)          Key Vault
     (Central India, PgBouncer)         container: licences (SAS upload)   JWT secret, DB URL,
                                        container: shop-media (public read) SMS API key
                     ▲
     Timer Functions: no-show sweeper (5 min), licence-expiry (hourly), purge (daily)
     Application Insights: logs, metrics, alerts
```

Decisions (ADR-lite):

- **Frontend on Blob static website** (as requested). Front Door gives HTTPS on the custom domain and **same-origin `/api`**, so auth can use an httpOnly cookie and no CORS is needed.
- **API on Azure Functions** (Flex Consumption plan, or Consumption if Flex is unavailable in Central India). Blob storage cannot run code, so the API must live elsewhere.
- **PostgreSQL Flexible Server**, Burstable **B1ms**, 32 GB, PgBouncer on (port 6432), Central India region, private access via VNet if budget allows, else public access with firewall + SSL required.
- **No real-time infra.** Shop/gate screens poll every 10 s. Load is small (pilot: ≤ 10 shops, ≤ 500 visits/day).
- **Maps:** Leaflet + OpenStreetMap tiles (low volume, attribution shown). Distance by Haversine from browser geolocation or chosen area centroid.
- **OTP SMS:** MSG91 (India). ⚠️ Needs DLT sender ID + template registration, which can take several days — start on day 1. Fallback: WhatsApp OTP via MSG91, or Azure Communication Services SMS if available for India. In `dev`, OTP is always `123456`.

Estimated monthly cost for the pilot (approximate, verify in Azure pricing calculator): Front Door Standard ~US$35 + traffic, Postgres B1ms ~US$15–25, Functions ~US$0–5, Storage < US$2, App Insights < US$5, SMS ~₹0.2 per OTP.

---

## 4. Tech stack (pin these)

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere, `strict: true` |
| Monorepo | pnpm workspaces |
| Frontend | Vite + React 18 + React Router 6 + TanStack Query + Tailwind CSS + i18next + `vite-plugin-pwa` |
| QR render | `qrcode` (render to canvas/SVG) |
| QR scan | `BarcodeDetector` API when available, fallback `@zxing/browser` |
| Maps | `leaflet` + `react-leaflet` |
| API | Azure Functions v4 Node programming model (`@azure/functions`), Node 20 |
| Validation | `zod` (shared between web and API) |
| DB | PostgreSQL 16; **Drizzle ORM** + `drizzle-kit` migrations; `pg` driver |
| Auth | Phone OTP → JWT (HS256, secret in Key Vault) in httpOnly, Secure, SameSite=Lax cookie `pp_session` |
| Blob | `@azure/storage-blob` (user-delegation SAS for licence uploads) |
| Tests | Vitest (unit), Supertest-style handler tests, Testcontainers Postgres (integration), Playwright (e2e) |
| IaC | Bicep (`infra/`) |
| CI/CD | GitHub Actions with Azure OIDC federated credentials (no stored secrets) |
| Observability | Application Insights (`applicationinsights` SDK in API, web-vitals in web) |

---

## 5. Repository layout

```
pataka-pickup/
├─ CLAUDE.md
├─ docs/SPEC.md                 # this file
├─ package.json  pnpm-workspace.yaml  tsconfig.base.json  .editorconfig
├─ docker-compose.yml           # local Postgres 16 + Azurite (blob emulator)
├─ packages/
│  └─ shared/                   # zod schemas, types, QR codec, slot math, copy-lint word list
│     └─ src/{schemas,qr,slots,constants}.ts
├─ apps/
│  ├─ web/                      # React PWA (customer, shop, gate, admin)
│  │  ├─ src/
│  │  │  ├─ routes/{customer,shop,gate,admin}/
│  │  │  ├─ components/  hooks/  lib/api.ts  lib/planList.ts
│  │  │  └─ i18n/{en,te}.json
│  │  └─ public/  (icons, manifest)
│  └─ api/                      # Azure Functions
│     ├─ src/functions/         # one file per HTTP/timer function
│     ├─ src/db/{schema.ts,client.ts,migrations/}
│     ├─ src/lib/{auth.ts,otp.ts,rateLimit.ts,blob.ts,audit.ts,errors.ts}
│     └─ host.json  local.settings.example.json
├─ infra/                       # main.bicep + modules
├─ scripts/                     # seed.ts, purge-dry-run.ts
└─ .github/workflows/{ci.yml,deploy.yml}
```

---

## 6. Data model (PostgreSQL)

All timestamps `timestamptz`; business time zone **Asia/Kolkata**. IDs are `uuid` (`gen_random_uuid()`). Every table has `created_at`, `updated_at`.

### 6.1 Enums

```sql
CREATE TYPE user_role       AS ENUM ('customer','shop_owner','shop_staff','marshal','admin');
CREATE TYPE licence_status  AS ENUM ('pending','verified','rejected','expired');
CREATE TYPE green_cert_type AS ENUM ('CSIR_NEERI_SWAS','CSIR_NEERI_STAR','CSIR_NEERI_SAFAL','CSIR_NEERI_OTHER'); -- verify current names with shops
CREATE TYPE visit_status    AS ENUM ('booked','arrived','served','no_show','cancelled');
```

### 6.2 Tables

```sql
-- People
users (
  id uuid PK, phone_e164 text UNIQUE NOT NULL, display_name text,
  role user_role NOT NULL DEFAULT 'customer',
  no_show_strikes int NOT NULL DEFAULT 0,
  blocked_until timestamptz,             -- set when strikes >= 3
  deleted_at timestamptz
)
consents (id, user_id FK, purpose text NOT NULL, version text NOT NULL, granted_at timestamptz, withdrawn_at timestamptz)
otp_requests (id, phone_e164, code_hash text, expires_at, attempts int DEFAULT 0, consumed_at, ip inet)

-- Places
clusters (id, name, area text, lat numeric(9,6), lng numeric(9,6), address text,
          bay_count int NOT NULL DEFAULT 20, gate_notes text, is_active bool DEFAULT true)
shops (id, cluster_id FK NULL, short_code text UNIQUE NOT NULL CHECK (short_code ~ '^[A-Z0-9]{3,6}$'),
       name, area, lat, lng, address, phone_e164, photo_url,
       open_from time, open_to time, slot_minutes int DEFAULT 30,
       default_capacity_per_slot int DEFAULT 10, is_live bool DEFAULT false)
shop_licences (id, shop_id FK, licence_no text NOT NULL, licence_type text NOT NULL, -- e.g. 'LE-5', 'Temporary'
               issued_by text, valid_from date, valid_to date NOT NULL,
               image_blob_path text NOT NULL, status licence_status DEFAULT 'pending',
               verified_by uuid FK users, verified_at timestamptz, notes text)
shop_members (shop_id FK, user_id FK, role user_role CHECK (role IN ('shop_owner','shop_staff')), PRIMARY KEY (shop_id,user_id))
cluster_marshals (cluster_id FK, user_id FK, PRIMARY KEY (cluster_id,user_id))

-- Catalogue (price list only — NOT an order system)
categories (id, slug UNIQUE, name_en, name_te, sort int, is_banned bool DEFAULT false, banned_reason text)
items (id, shop_id FK, item_no int NOT NULL,          -- small per-shop number used in QR
       category_id FK, name_en, name_te, pack_desc text,  -- "10 pcs", "1 box"
       price_paise int NOT NULL CHECK (price_paise > 0),
       green_cert green_cert_type NOT NULL, green_ref text NOT NULL,  -- QR/batch ref on the box
       rack_code text,                                      -- helps packers, e.g. "B3"
       image_url text, is_sold_out bool DEFAULT false, is_active bool DEFAULT true,
       UNIQUE (shop_id,item_no))
-- Trigger: reject insert/update if category.is_banned = true.
shop_price_versions (shop_id PK FK, version int NOT NULL DEFAULT 1)  -- bump on any price/item change

-- Slots and visits (queue tokens — no items, no amounts)
slots (id, shop_id FK, starts_at, ends_at, capacity int, booked int DEFAULT 0,
       CHECK (booked <= capacity), UNIQUE (shop_id, starts_at))
visits (id, code char(6) UNIQUE NOT NULL,     -- Crockford base32, e.g. K7Q2M9
        user_id FK, shop_id FK, slot_id FK,
        status visit_status NOT NULL DEFAULT 'booked',
        party_vehicle text,                    -- optional "car"/"bike"/"walk"
        bay_no int, arrived_at, served_at, cancelled_at, no_show_at)
-- One active visit per user:
CREATE UNIQUE INDEX one_active_visit ON visits(user_id) WHERE status IN ('booked','arrived');

-- Ops
rate_limits (key text PK, window_start timestamptz, count int)
audit_log (id, actor_user_id, action text, entity text, entity_id uuid, meta jsonb, at timestamptz DEFAULT now())
daily_shop_stats (shop_id, day date, booked int, arrived int, served int, no_show int, cancelled int, PRIMARY KEY (shop_id, day))
```

### 6.3 Views and rules

```sql
CREATE VIEW visible_shops AS
SELECT s.* FROM shops s
WHERE s.is_live
  AND EXISTS (SELECT 1 FROM shop_licences l
              WHERE l.shop_id = s.id AND l.status = 'verified'
                AND current_date BETWEEN l.valid_from AND l.valid_to);
```

- **Never** add columns for item lists, quantities or money to `visits`. (G1, G4)
- Booking a slot is atomic:

```sql
UPDATE slots SET booked = booked + 1
WHERE id = $1 AND booked < capacity AND starts_at > now() + interval '30 minutes'
RETURNING id;   -- 0 rows → "slot full"
-- then INSERT INTO visits … in the same transaction; unique index enforces 1 active visit
```

- Cancel / no-show decrements `booked` in the same transaction.

### 6.4 Seed data (`scripts/seed.ts`)

- Categories (allowed): sparklers, flower-pots, ground-chakkar, pencils, twinkling-stars, rockets, aerial-shots, fountains, sound-crackers-green, kids-safe.
- Categories (**banned**, `is_banned=true`): `series-lari` ("Joined crackers banned — SC order 2018/2021"), `barium-based`.
- 2 clusters, 4 demo shops (`SLC01` Sri Lakshmi Crackers, Gachibowli; `BAL01` Balaji Fireworks; `ANA01` Anand Crackers; `DEM01`), 15 items each, verified demo licences valid to 2026-11-30.
- Users: one admin, one owner + one staff per shop, one marshal per cluster. Phones `+9190000000xx`.

---

## 7. QR codes (two payloads, one image)

The ticket shows **one QR** containing the visit code and the plan list. It uses only QR *alphanumeric* characters (`0-9 A-Z $%*+-./:` and space) so a 30-item list still scans fast at night.

```
PP1.<VISITCODE>.<SHOPCODE>.<PRICEVER>.<ITEMS>
ITEMS = <itemNo base36>*<qty base36> joined by "-"     (max 40 lines, qty 1–99)

Example: PP1.K7Q2M9.SLC01.C.3*2-7*1-1A*4
         → visit K7Q2M9, shop SLC01, price version 12, items #3×2, #7×1, #46×4
Walk-in list (no slot): PP1.-.SLC01.C.3*2-7*1
```

Implementation (`packages/shared/src/qr.ts`), with exhaustive unit tests:

- `encodePlan({visitCode, shopCode, priceVersion, lines}) → string`
- `decodePlan(text) → Result<PlanPayload, DecodeError>` (rejects wrong prefix, bad chars, > 40 lines, qty 0)
- Round-trip property test (fast-check) over random lists.

Who reads what:

| Scanner | Reads | Server call |
|---|---|---|
| Gate app | `VISITCODE`, `SHOPCODE` | `POST /api/gate/checkin` with code only |
| Counter (shop app) | everything | `POST /api/shop/visits/{code}/serve` with code only — **the items are decoded and priced on the device and never sent to the server** (G1, G2) |

At the counter the app loads the shop's **current** price list (cached), then shows:

1. **Pick list** grouped by `rack_code` (big text, tick boxes).
2. **Bill** with current prices, line totals, grand total; items whose price changed since `PRICEVER` or that are sold out are highlighted. Footer: "Pay at this counter. Pataka Pickup does not handle payments."
3. Buttons: **Print** (browser print, 58 mm thermal CSS) and **Mark served**.

The bill is computed and displayed locally; nothing about it is stored server-side.

---

## 8. API (Azure Functions, all under `/api`)

Conventions: JSON; zod-validated bodies; errors `{ error: { code, message } }`; auth via `pp_session` cookie; role checks in a `requireRole()` helper; every mutating call writes `audit_log`. Rate limits use the `rate_limits` table.

### Public
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | DB ping |
| GET | `/areas` | Distinct areas with centroid |
| GET | `/shops?area=&lat=&lng=` | From `visible_shops`; distance, open now, next free slot |
| GET | `/shops/{shortCode}` | Shop + licence no. + valid_to + price version |
| GET | `/shops/{shortCode}/items` | Active items with categories; `Cache-Control: max-age=60`; ETag = price version |
| GET | `/shops/{shortCode}/slots?date=` | Slots with `remaining = capacity - booked` |

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/otp/request` | `{phone}`; 3 per phone / 10 min, 10 per IP / hour; 6-digit, bcrypt-hashed, 5 min expiry |
| POST | `/auth/otp/verify` | `{phone, code, consentVersion}`; 5 attempts max; creates user + consent; sets cookie (customers 30 days, staff 12 h) |
| POST | `/auth/logout` | Clears cookie |
| GET | `/me` | Profile, role, memberships, active visit |
| DELETE | `/me` | Soft-delete + anonymise phone (G9) |

### Customer (role `customer`+)
| Method | Path | Notes |
|---|---|---|
| POST | `/visits` | `{shopShortCode, slotId, vehicle?}` → `{code, slot, shop}`. Rejects if blocked, already has active visit, slot full, or < 30 min to start. **Body schema has no items field; extra keys rejected (`.strict()`).** |
| GET | `/visits/current` | Active visit or null |
| POST | `/visits/{code}/cancel` | Until slot start; frees capacity |

### Gate (role `marshal`, cluster member)
| Method | Path | Notes |
|---|---|---|
| POST | `/gate/checkin` | `{code}` → validates shop in marshal's cluster, slot window (−30 min … +15 min), status `booked`; assigns next free bay (or `{bayNo}` override); status → `arrived` |
| GET | `/gate/today` | Arrivals list + bay occupancy for the cluster |

### Shop (role `shop_owner` / `shop_staff`, shop member)
| Method | Path | Notes |
|---|---|---|
| GET/POST/PATCH | `/shop/items` | Owner: CRUD items (banned categories → 422); staff: sold-out toggle only. Any change bumps price version |
| PATCH | `/shop/items/{id}/sold-out` | `{isSoldOut}` |
| GET/PUT | `/shop/slots?date=` | Owner sets hours + capacity; server (re)generates slots without dropping booked ones |
| GET | `/shop/visits/today` | Slot-wise list with statuses (poll 10 s) |
| POST | `/shop/visits/{code}/serve` | `arrived`/`booked` → `served` |
| POST | `/shop/visits/{code}/no-show` | Manual no-show |
| GET | `/shop/stats?from=&to=` | From `daily_shop_stats` — footfall only, no money (G4) |
| POST | `/shop/licence/upload-url` | Returns 10-min write SAS for `licences/{shopId}/{uuid}.jpg` |
| POST | `/shop/licence` | Register uploaded licence (status `pending`) |

### Admin (role `admin`)
CRUD `/admin/clusters`, `/admin/shops`, `/admin/categories`, `/admin/members`; `GET /admin/licences?status=pending` (with 5-min read SAS); `POST /admin/licences/{id}/verify|reject`; `POST /admin/users/{id}/unblock`; `GET /admin/metrics` (per shop/day: booked, arrived, served, no-show rate, median arrive→serve minutes).

### Timer functions
| Name | Schedule | Job |
|---|---|---|
| `noShowSweeper` | every 5 min | `booked` visits where `slot.ends_at + 15 min < now()` → `no_show`, `booked -= 1`, `strikes += 1`; strikes ≥ 3 → `blocked_until = season_end` |
| `licenceExpiry` | hourly | `valid_to < current_date` → `expired` (shop drops out of `visible_shops`) |
| `dailyStats` | 23:55 IST | Upsert `daily_shop_stats` |
| `purge` | 03:00 IST daily | After `SEASON_END + 90 days`: delete visits, otp_requests, anonymise users (G9). Dry-run script in `scripts/` |

---

## 9. Screens and UX

### Customer
1. **Home / area:** area dropdown (Gachibowli, Madhapur, Hitec City, Kondapur, Banjara Hills, Jubilee Hills …) + "Use my location". Map + list of licensed shops: name, distance, open/closed, next free slot, licence badge ("Licence LE-5 · valid to 30 Nov").
2. **Shop page:** category chips, search, items with price, pack, green-cert badge, "Sold out" greyed. "+" adds to **plan list** (localStorage key `pp.plan.<shopCode>`). Sticky bar: "Plan list · 5 items · est. ₹1,500".
3. **Plan list:** edit quantities, note "Prices are final at the counter. This list is saved only on your phone." Buttons: **Book a pickup slot** · **Show list QR (walk-in)**.
4. **Slot picker:** date tabs, 30-min slots with remaining count; vehicle (car / two-wheeler / on foot).
5. **Login (only now):** phone → OTP → consent checkbox (purpose: "to hold your slot and stop slot misuse").
6. **Ticket:** large QR, visit code in text, shop, cluster address + map link, slot time, bay instructions, estimated total, **safety notice (G8)**, Cancel. Works offline after first load (PWA cache).

### Shop
- **Today:** slot rows with counts; visitors with status chips (booked / arrived bay 7 / served).
- **Scan:** full-screen camera → pick list → bill → Print / Mark served.
- **Price list:** table editor, bulk sold-out toggle, add item (category dropdown excludes banned; green-cert type + ref required).
- **Slots:** hours + capacity per 30 min per date.
- **Licence:** upload photo, status.
- **Report:** footfall per day.

### Gate
- One giant **Scan** button, result card (green = valid → "Send to bay 7", red = reason: wrong cluster / too early / already used / cancelled), manual code entry, today's arrivals list.

### Admin
- Pending licences queue with image viewer, verify/reject. Shops, clusters, members, categories, metrics table, unblock user.

### Copy rules (G5)
Use: plan list, pickup slot, visit, ticket, "prices final at the counter", "pay at the shop". Never: order, reserve/reservation, cart, checkout, buy now, booking confirmed, delivery, 100% legal.

---

## 10. Security checklist

- httpOnly + Secure + SameSite=Lax cookie; CSRF: require custom header `X-PP: 1` on all mutating requests (same-origin via Front Door).
- JWT 30 d (customer) / 12 h (staff); include `role`, `sub`, `ver`; bump `ver` on logout-all.
- OTP: bcrypt hash, constant-time compare, attempt caps, IP + phone rate limits.
- Row-level authorisation in every shop/gate handler (`shop_members`, `cluster_marshals`).
- Licence images in **private** container; SAS only (write 10 min, read 5 min).
- Postgres: SSL required, least-privilege app role (no DDL), migrations run by a separate role in CI.
- Secrets only in Key Vault, referenced from Function App settings (`@Microsoft.KeyVault(...)`).
- Front Door WAF (managed rule set) if on Premium; otherwise rely on rate limiting in API.
- Security headers on static site via Front Door rules: CSP (self + OSM tiles), HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (camera=self, geolocation=self).

---

## 11. Azure infrastructure (Bicep, `infra/main.bicep`)

Parameters: `env` (`dev`|`prod`), `location` (`centralindia`), `domain`, `seasonEnd` (`2026-11-20`).

Resources:

1. Resource group `rg-pataka-<env>`.
2. **Storage account** `stpataka<env>` (StorageV2, LRS, TLS1.2, no public blob access except `$web`):
   - Static website enabled, index `index.html`, error document `index.html` (SPA routing).
   - Containers: `licences` (private), `shop-media` (blob read).
3. **PostgreSQL Flexible Server** `psql-pataka-<env>`: v16, Burstable B1ms, 32 GB, backup 7 days, PgBouncer enabled, `require_secure_transport=on`, database `pataka`.
4. **Function App** `func-pataka-<env>`: Linux, Node 20, Flex Consumption (fallback Consumption Y1), system-assigned managed identity, App Insights connection.
5. **Key Vault** `kv-pataka-<env>`: secrets `DATABASE-URL`, `JWT-SECRET`, `MSG91-AUTH-KEY`, `MSG91-TEMPLATE-ID`. Function identity gets *Key Vault Secrets User*; also *Storage Blob Data Contributor* on the storage account (for user-delegation SAS).
6. **Front Door Standard** `afd-pataka-<env>`: endpoint + custom domain with managed cert; origin group `web` → storage static website host; origin group `api` → Function App host; routes `/api/*` → api (caching off), `/*` → web (caching on; `index.html` no-cache via rule set).
7. **Application Insights** + Log Analytics workspace; alerts: 5xx rate > 2 % over 5 min, `/api/health` failing, Postgres CPU > 80 %.

Function app settings: `DATABASE_URL`, `JWT_SECRET`, `MSG91_*` (Key Vault refs), `OTP_DEV_MODE=false`, `SEASON_END`, `TZ=Asia/Kolkata`, `STORAGE_ACCOUNT_NAME`.

---

## 12. CI/CD (GitHub Actions)

**`ci.yml`** (every PR): pnpm install → typecheck → lint → copy-lint (G5) → guardrail tests (G1, G3) → unit tests → integration tests (Testcontainers Postgres) → build web + api → Playwright e2e against `docker-compose` stack.

**`deploy.yml`** (push to `main` → dev; tag `v*` → prod, with manual approval environment):

1. `azure/login` with OIDC (federated credential; no client secret).
2. `az deployment group create -f infra/main.bicep` (what-if on PR, apply on deploy).
3. DB migrations: `pnpm --filter api db:migrate` using the migration role connection string from Key Vault.
4. API: `pnpm --filter api build` → `Azure/functions-action` zip deploy.
5. Web: `pnpm --filter web build` (env `VITE_API_BASE=/api`) → `az storage blob upload-batch -d '$web' -s apps/web/dist --overwrite` with `--content-cache-control "public,max-age=31536000,immutable"` for hashed assets and `no-cache` for `index.html`, `sw.js`, `manifest.webmanifest`.
6. Purge Front Door cache for `/index.html`, `/sw.js`.
7. Smoke test: `curl -f https://<domain>/api/health` and Playwright `@smoke` tag.

---

## 13. Local development

```bash
docker compose up -d            # postgres:16 on 5432, azurite on 10000
pnpm i
cp apps/api/local.settings.example.json apps/api/local.settings.json
pnpm db:migrate && pnpm db:seed
pnpm dev                        # vite on 5173 (proxy /api → 7071), func start on 7071
```

`OTP_DEV_MODE=true` → OTP is always `123456` and is logged, never sent.

---

## 14. Build phases (run one per Claude Code session)

Each phase ends with **all tests green**, a short `CHANGELOG.md` entry and a commit. Target dates match the pilot plan.

### Phase 0 — Scaffold (15 Oct)
Monorepo, tsconfig, ESLint/Prettier, Vitest, docker-compose, Azure Functions skeleton with `/api/health`, Vite app with router and i18n (en/te), Tailwind, PWA plugin, GitHub CI running typecheck + tests.
**Accept:** `pnpm dev` serves web and `/api/health` returns `{ok:true, db:true}`; CI green.

### Phase 1 — Database + shared package (15–16 Oct)
Drizzle schema for section 6, migrations, `visible_shops` view, banned-category trigger, seed script. `packages/shared`: zod schemas, QR codec + property tests, slot generation helpers, copy-lint word list.
**Accept:** migration up/down works on fresh DB; seed loads; QR round-trip tests pass; guardrail test G1 passes.

### Phase 2 — Auth (16–17 Oct)
OTP request/verify, MSG91 adapter + dev adapter, rate limits, JWT cookie, `requireRole`, `/me`, `DELETE /me`, consents.
**Accept:** integration tests for happy path, wrong code, expired code, rate-limit hit, deleted user.

### Phase 3 — Customer flow (17–20 Oct)
Public shop/item/slot endpoints; customer screens 1–6; plan list in localStorage; atomic slot booking; ticket with QR and safety notice; cancel.
**Accept:** Playwright: browse → plan 5 items → login → book → ticket shows QR that decodes to the same list; concurrent booking test (50 parallel requests on capacity 10 → exactly 10 succeed); second active visit rejected.

### Phase 4 — Shop app (20–23 Oct)
Price list editor, sold-out toggle, slot capacity editor, today list, **counter scan → pick list → bill → print → mark served**, licence upload with SAS, footfall report.
**Accept:** Playwright with a fake camera feed (inject QR image) produces the correct bill; price-changed and sold-out lines highlighted; no network request contains item data (assert in test by inspecting all requests).

### Phase 5 — Gate app + timers (23–24 Oct)
Gate scan/check-in with bay assignment and validation errors; `noShowSweeper`, `licenceExpiry`, `dailyStats`, `purge` (with dry-run).
**Accept:** time-travel tests for no-show strikes and blocking; expired licence hides shop from `/shops`.

### Phase 6 — Admin (24 Oct)
Licence verification queue, shops/clusters/members/categories CRUD, metrics, unblock.
**Accept:** a new shop is invisible until licence verified; becomes visible after verify.

### Phase 7 — Azure deploy (24–25 Oct)
Bicep, OIDC, deploy workflow, Front Door routes/rules, Key Vault refs, alerts. Deploy `dev`, then `prod`.
**Accept:** prod URL serves the app over HTTPS; `/api/health` green; Playwright `@smoke` passes against prod; App Insights shows traces.

### Phase 8 — Hardening + dry run (26–28 Oct)
Lighthouse PWA ≥ 90 and performance ≥ 85 on a mid-range Android profile; accessibility pass (contrast, tap targets, screen-reader labels); Telugu strings reviewed by a native speaker; load test (k6) 50 rps on `/shops/*/items` and 10 rps on `/visits` with p95 < 500 ms; backup restore drill; runbook (section 15).
**Accept:** all of the above recorded in `docs/READINESS.md`.

Pilot live **29 Oct**. Code freeze except bug fixes until 9 Nov.

---

## 15. Runbook (pilot season)

| Problem | Action |
|---|---|
| OTP SMS not arriving | Check MSG91 dashboard/DLT status; switch `OTP_PROVIDER=whatsapp`; as last resort admin issues a one-time code from `/admin` |
| Gate scanner fails | Manual code entry on gate app; printed list of today's codes per shop (`/shop/visits/today` → Print) |
| Internet down at cluster | Shop app caches price list; counter scan works offline (decoding is local); "Mark served" queued and synced later (Workbox background sync) |
| Shop overloaded | Owner lowers capacity for remaining slots (existing visits kept) |
| Police/fire officer asks about the platform | Show the one-page explainer (`/about`): no orders, no payments, no stock, licensed shops only, licence numbers listed |
| Licence query on a shop | Admin sets `is_live=false` immediately; shop disappears from public lists |

---

## 16. CLAUDE.md (copy to repo root)

```markdown
# CLAUDE.md — Pataka Pickup

Full spec: docs/SPEC.md. Read it before any task. Work only on the phase I name.

## Non-negotiable guardrails (see SPEC §1)
- G1/G2: Never store, send or accept item lists server-side. Plan lists live in localStorage and the QR only. No order_items/cart/booking_items tables or fields.
- G3: No payment SDKs, gateways, UPI links or wallets.
- G4: No money fields on visits; no commission logic.
- G5: Banned words in UI copy: order, reserve, reservation, cart, checkout, buy now, booking confirmed, delivery, 100% legal.
- G6: Public shop queries go through the `visible_shops` view only.
- G7: Banned categories cannot be created; every item needs green_cert + green_ref.
- G8: Ticket always shows the safety notice.
- G9: Phone number is the only personal data; consent + purge + delete-me.
If a request would break a guardrail, stop and tell me instead of implementing it.

## Stack
pnpm monorepo · TypeScript strict · Vite/React/Tailwind/TanStack Query/i18next PWA · Azure Functions v4 (Node 20) · PostgreSQL 16 + Drizzle · zod in packages/shared · Vitest, Testcontainers, Playwright · Bicep · GitHub Actions OIDC.

## Commands
- pnpm dev · pnpm test · pnpm test:int · pnpm e2e · pnpm lint · pnpm typecheck
- pnpm db:migrate · pnpm db:seed · pnpm copy-lint

## Working rules
- TDD for shared logic (QR codec, slot math, booking transaction, no-show sweeper).
- Every API handler: zod `.strict()` body, role + membership check, audit_log on mutation.
- Money in integer paise; times as timestamptz, display in Asia/Kolkata.
- All UI strings in i18n/en.json and i18n/te.json — no hard-coded copy.
- Before saying a phase is done: run typecheck, lint, copy-lint, all tests, and show the output.
- Small commits with clear messages. Update CHANGELOG.md per phase.
```

---

## 17. Open items for the owner (not for Claude Code)

- [ ] Written legal opinion on the "plan list + slot" model from a Hyderabad Explosives Act lawyer (go/no-go 17 Oct).
- [ ] MSG91 account, DLT entity + sender ID + OTP template approval (start immediately).
- [ ] Domain name and DNS access for Front Door custom domain.
- [ ] Azure subscription with Central India quota for Postgres Flexible Server and Functions.
- [ ] Holding-bay locations agreed with the fire officer and police for each pilot cluster.
- [ ] Telugu translation review.
- [ ] Confirm current CSIR-NEERI green-cracker labels with partner shops (enum in §6.1).

