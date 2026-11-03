# Changelog

## Production-ready release (2026-11-03)

- **Icons instead of emojis:** one line-icon set (lucide, 1.75 stroke) across every screen; the
  "Green crackers only" and green-certificate badges use a leaf icon; payment methods, printing,
  photos, alerts and empty states use matching icons. Hard-coded payment method names now use
  the translated labels.
- **Razorpay adapter** (`apps/api/src/lib/payments/razorpay.ts`, REST only — G3) for the ₹30
  order fee and the merchant subscription: hosted Payment Links with a stable reference (a retry
  returns the same link), HMAC-verified webhooks, refunds; payers return to their order or review
  page. Production refuses test keys. Bicep, Key Vault and the infra workflow carry the keys;
  `params.prod.json` selects `razorpay`.
- **Production readiness check:** `/api/health` reports `config` and answers 503 in prod until
  every live setting is in place; the deploy smoke test fails on a missing secret.
- **Demo data can no longer reach production:** `pnpm db:seed` refuses `APP_ENV=prod` and Azure
  databases (unless `SEED_ALLOW_AZURE=true` for dev).
- Load test re-run on this release (docs/LOAD_TEST_REPORT.md). L1 unchanged: `ORDERING_ENABLED`
  stays off in production until the legal opinion.

## Growth follow-ups (2026-11-03)

- **Growth demo data:** `pnpm db:seed` now builds an influencer, an agent recruited by them with
  three shops (consent pending, owner's review, live with the ₹1,000 payout), wallet withdrawals
  (one sent, one waiting), a pending agent, and customer referrals with credit, all through the
  real growth code (`apps/api/scripts/seedGrowth.mts`). The demo switcher shows agents and
  influencers as their own accounts and opens their pages.
- **Sign-off recorded:** the CA approved the TDS handling and the in-app agreements
  (`docs/GROWTH.md`). The L1 legal opinion is still pending; `ORDERING_ENABLED` is unchanged.
- **Review reminders:** an hourly job notifies the agent in-app when the owner has not answered
  the review link after 24 hours and again after 48 hours (once each, recorded as shop events).
- **Influencer link visits:** `/r/DXI-…` visits are counted (once per link per browser per day,
  30 an hour per IP, active influencers only) and shown on the influencer page. Migration 0015.
- **Photo check:** licence, document and product photos are checked on the device for darkness,
  glare and blur; a failed photo gets a retake prompt (product photos: "use anyway"). Advisory only.
- Web test timeout raised to 15 s (full-page renders under a parallel run).

## Growth program, optional green certificate, separate frontend and backend deploys (2026-11-03)

- **Guardrails (owner's decision):** G3 amended (flat fees only: the ₹30 order fee and the
  ₹1,999 + GST merchant subscription; money leaves only under G13), G5 adds cashback, earn money,
  income and guaranteed, G7 relaxed (the platform sells all goods: a green certificate is
  optional), G9 extended to agents and influencers (UPI ID and PAN encrypted, cleared on
  delete-me and by the purge), new G12 (single-level rewards on a paid, packed first order or a
  paid live merchant) and G13 (append-only, idempotent money rows). L1 unchanged.
- **Agents:** registration with UPI ID and terms, admin approval, one device at a time; new
  merchant → owner consent by SMS code or Approve link (3 wrong codes lock it for an hour) →
  setup in the normal shop screens (products, licence and documents, hours) plus GSTIN, map pin,
  address → submit (needs licence, valid GSTIN, hours, map pin, 10 products with photos) →
  owner's review link (approve and pay ₹2,359 online or by bank transfer, ask for changes,
  decline, report) → owner takes the shop → live on licence verification → ₹1,000 once.
- **Influencers:** code and QR, customer and agent links, ₹10 per follower's packed first order,
  ₹10 once per recruited agent's first live merchant.
- **Wallets:** ₹2,000 a day, PAN at ₹18,000, 2% TDS on the excess above ₹20,000, transfers
  recorded by an admin with the UTR, failures returned once, 3 failures freeze.
- **Customer referrals and credit:** DXR- codes, claim before the first order, ₹10 credit on the
  referee's first packed order (reversed if the fee is refunded); credit used at a listed shop's
  counter (held with the balance locked, redeemed with the bill, shown on the bill); merchants
  are paid it weekly or on request once a day.
- **Kits:** five standard kit types; a kit is one product with contents; Home → Kits compares shops.
- **Shop QR poster / standee** (print or save as PDF), **terms pages** per party, in-app notices.
- **Migration 0014** (agents, influencers, wallets, ledgers, withdrawals, referrals, credit,
  redemptions, settlements, subscriptions, consents, owner links, feedback, terms, notifications;
  items kind/kit fields; optional green certificate; `visible_shops` excludes shops still being
  set up). Endpoints listed in `docs/GROWTH.md`; strings in en/te/hi.
- **Deployment split:** `deploy-infra.yml` (Bicep), `deploy-api.yml` (backend: build, migrate,
  zip deploy) and `deploy-web.yml` (frontend: Blob static website upload, Front Door purge), each
  on its own paths; per-app READMEs; optional frontend on another domain (`webOrigins` → CORS with
  credentials and SameSite=None cookies; `VITE_API_BASE`).
- Checks: see the final run in this release's notes (typecheck, lint, copy-lint, i18n-lint, unit
  and integration tests, build).

## Sale modes, automatic barcodes, merchant documents, mobile filters, languages, design system, peak load (2026-11-03)

- **Sale mode (never empty):** every product is sold either _Sale on MRP_ (normal / pack: MRP and
  offer price per pack) or _Sale by weight_ (kilo sale: price per kg, offer price per kg and the
  weight of one pack). Name, category and pack details are common to both. The server works out
  the pack price from the rate per kg (`resolvePricing` in `packages/shared/src/catalogue.ts`,
  unit-tested; G11). Orders, stock, packing and bills still count whole packs, so those flows are
  unchanged. Migration 0013 adds `items.sale_mode` (enum, NOT NULL), `price_per_kg_paise` and
  `offer_price_per_kg_paise`, plus a check that each mode has its own fields. Existing kilo packs
  keep their pack price, and their rate per kg is worked out from it.
- **Automatic barcodes:** a new product gets a unique in-store EAN-13 (GS1 prefix 20, check digit)
  with no typing. A box barcode can still be used when editing, and clearing it asks for a new
  one. Every product now has a barcode (checked by the database), and migration 0013 backfills the
  existing ones. The barcode's origin is recorded: box barcodes must be scanned at packing, while
  generated ones can also be picked by hand, so packing works as before for shops that have not
  printed labels yet. Products have a printable label (58 mm counter printer).
- **Merchant documents (Licence tab):** the licence upload stays, and five categories are added:
  Fire Department Licence, Police Licence / Clearance, Government Authority Licence, GST
  Certificate (GSTIN checked, including its check character) and Business Registration
  Certificate. Each is a PDF or photo up to 5 MB, stored privately, and shows Not uploaded /
  Pending check / Verified / Rejected (with the reason) / Expired. A replacement starts pending
  again, and earlier uploads are kept for the record. New admin tab **Documents**: open the file,
  verify, reject or withdraw a verification (a reason is required). Documents do not change shop
  visibility, which still follows the verified licence (G6). Endpoints: `GET /shop/documents`,
  `POST /shop/documents/new`, `GET /shop/documents/{id}/file`,
  `GET /console/documents?status=`, `GET /console/documents/{id}/file`,
  `POST /console/documents/{id}/verify|reject`. All are audited.
- **Mobile filters on the shop page:** no dropdowns. A search box, category chips that scroll
  sideways, and a Filters button (with a count) opening a bottom sheet for sort, kilo sales and
  standard products. Active filters show as removable chips.
- **Languages:** English, Telugu and Hindi replace each other completely. The choice is saved on
  the account (`PATCH /api/me {lang}`, `users.lang`) and follows the person to any device; a first
  visit uses the phone's language. Bills show item names in the reader's language. Hard-coded
  English was moved into the catalogues, and `pnpm i18n-lint` (in `pnpm check` and CI) now fails on
  hard-coded copy or on a key missing from any catalogue. A test fails if a Telugu or Hindi string
  is just the English copied over, or loses a `{{placeholder}}`. Found and fixed on the way: the
  missing `counter.orderCode` key (the report showed the raw key), an English "A → Z" in te/hi,
  and the browser's own file-picker text, now replaced with a translated file picker.
  Native-speaker review is still needed.
- **Design system (Better Analytics v1):** Plus Jakarta Sans; one action blue (#0A65A1) for
  buttons, links, tabs and toggles; brand-900 identity blocks; flat 1px-border cards with
  12 px radius and 8 px controls; status colours always paired with a word; no gradients; 2 px focus
  ring. Applied through the theme tokens and shared components, so every screen changed.
- **Peak load:** see `docs/LOAD_TEST_REPORT.md`. Public catalogue reads are cached in each instance
  (`CATALOGUE_CACHE_SECONDS`) and at the Front Door edge (a new `catalogue` route; other `/api`
  paths stay uncached, and responses that set no caching now default to `Cache-Control: no-store`).
  "Near me" returns the nearest 200 shops (906 KB → 62 KB), and the home page shows shops 24 at a
  time. Infra sizes are parameters (Postgres SKU, tier, HA and storage, Function instances,
  `DB_POOL_MAX`, PgBouncer on General Purpose); `params.prod.json` is sized for the peak. New
  tooling: `seed:load`, `bench:serve`, `scripts/loadtest.mjs`, `loadtest/k6-peak.js`.
- Unchanged: `ORDERING_ENABLED` legal gate (L1), the ₹30-only fee (G3), green certificate
  required on every product (G7).

## Fix: shop products failing to load after a release (2026-11-03)

- **Cause:** `GET /api/shops/{code}/items` used the shop's price version alone as its ETag
  (`"v1"`). After a release that changed the item shape (e.g. the listing-tag and kilo fields),
  browsers revalidating a copy cached earlier got `304 Not Modified`, reused the old body, failed
  schema validation and showed "Something went wrong". The same tag also hid stock and sold-out
  changes until the next price change.
- **Server:** the ETag is now the price version plus a hash of the response body, so it changes
  with stock, sold-out flags and response shape. Old `"v1"`-style tags always get a full `200`.
  SPEC §API table updated.
- **Web:** `api()` refetches a GET once past the HTTP cache (`cache: 'reload'`) when a response
  doesn't match the schema, so any cached response left over from an older release heals itself.
- **Offline cache (PWA):** the service worker keeps price lists for up to 2 days and serves them
  on slow or no signal. Item and category fields added after launch (`nameHi`, `isRecommended`,
  `isPopular`, `isStandard`, `weightGrams`) now default when missing, so a copy saved before a
  release still loads. New response fields should follow the same rule (see `domain.ts`).
- **`pnpm db:migrate` repairs renumbered migrations:** Drizzle only applies journal entries newer
  than the last one recorded, so a database that ran a branch's migration before a merge
  renumbered another one ahead of it skipped that migration for good (missing columns → 500s).
  `src/db/migrate.ts` first applies any unrecorded entry at or before the last recorded one, each
  in its own transaction, and records it as Drizzle does; then Drizzle runs as before. Used by
  `db:migrate`, `pnpm dev` and the integration-test setup.
- Checks: 140 unit tests (new: `api()` retry, old cached price list, migration planning),
  72 integration tests (ETag test extended; new migration-repair test on a real database),
  typecheck, lint, copy-lint, production build.

## Remove product (2026-11-02)

- **Merchant Products:** owners can remove a product (with confirmation) next to Edit and Hide.
  `DELETE /api/shop/items/{id}`, owner only, audited.
- Soft delete (migration 0011 `items.removed_at`, numbered after upstream 0008–0010): order lines and bills keep the product; it
  leaves the merchant and public lists, can no longer be edited, and its barcode is freed.
  Refused (409 `item_in_open_orders`) while an open order still needs it.
- Strings in en/te/hi. Checks: 118 unit tests, 67 integration tests, typecheck, lint, copy-lint.

## Packed-order photo (2026-11-02)

- **Packer:** after _Finish packing_ the screen shows two steps: 1 · print the sticker and stick it on the pack, 2 · take or upload a photo of the pack with the sticker's QR visible. The photo can be added or replaced while the order is packed, also from the reopened order. Optional; packing and the counter work as before without it.
- **Who sees it:** the shop's own staff (packing screen and Express Pickup counter), the order's customer (order page) and admins (orders list → _Packed photo_). Other shops, other customers and signed-out visitors get 404/401.
- **Storage:** new PRIVATE `order-photos` store (Bicep container; `.uploads/order-photos` locally), served only through `GET /api/shop/orders/{id}/pack-photo`, `/api/orders/{id}/pack-photo` and `/api/console/orders/{id}/pack-photo`, never through `/api/media`. Upload `POST /api/shop/orders/{id}/pack-photo` (packer; zod-strict body, JPEG/PNG/WebP magic-byte check, ≤ 2 MB, `order.pack_photo_uploaded` event + audit). Replaced photos are kept in the store.
- **Data:** migration 0008 adds `orders.pack_photo_path`, `pack_photo_at`, `pack_photo_by`; `packPhotoAt` on customer, staff and admin order views. Copy in en/te/hi.

## Shop page sort and filters (2026-11-02)

- **Customer shop page:** `[Search] [All categories ▼] [Sort by ▼] [Kilo sales toggle]`. The category buttons became a dropdown (same categories, same filtering). Sort starts at "Sort by" (the shop's own order); options: Recommended, Popular, A → Z, Price low → high, Price high → low. Recommended / Popular filter to owner-ticked items. Kilo sales shows only kilo items.
- **Kilo sale:** a product can be sold by weight (`weight_grams`, null = normal pack). The owner enters the weight (g or kg) and the existing Price is the price for that weight; the card adds one line, e.g. "⚖ 500 g · ₹260". Cart, quantities (whole products), orders, billing, stock and pricing are unchanged.
- **Merchant products form:** adds "Sold as: Normal / Pack | Kilo sale" (weight + unit for kilo sale) and two ticks, Recommended and Popular / Trending (set by the owner, not computed from sales). Existing fields and validation unchanged.
- Migration 0008 (`is_recommended`, `is_popular`, `weight_grams`; additive with defaults). Seed adds two demo kilo items and a family box.
- Sort/filter logic in `packages/shared/src/listing.ts` with unit tests.
- `pnpm db:embedded` reads its port from `apps/api/local.settings.json` (`DATABASE_URL`) when `PGPORT` isn't set.
- Checks: 129 unit tests, 65 integration tests, typecheck, lint, copy-lint.

## Pickup arrival & assistance (2026-11-02)

- **Customer:** "I'm coming for pickup" tells the shop they are on the way; optional assistance request (bring the packed order to the car, or another pickup request with notes) with live status.
- **Counter:** arrivals and assistance panel with approve/decline. Car-side handover is shown inactive pending compliance approval.
- **Gate:** assistance notifications with acknowledge.
- Server enforces every arrival/assistance state change (G11); strings in en/te/hi. Migration 0008 (renumbered after upstream 0007_hindi_names).
- Checks: 121 unit tests, 66 integration tests, typecheck, lint, copy-lint.

## Local dev: migrations on start, Postgres port 5433 (2026-11-02)

- `pnpm dev` now runs `pnpm db:migrate` before starting the web and API, so a local database that
  predates a schema change (e.g. migration 0007 `name_hi`) can no longer make catalogue requests
  fail with 500.
- Local Postgres (embedded and docker-compose) moved from 5432 to **5433** so a PostgreSQL service
  already installed on a developer machine never shadows it. `local.settings.example.json`,
  `drizzle.config.ts` and the README updated; existing `local.settings.json` files need the port
  changed by hand.
- `db:migrate` prints which database it could not reach and how to start it.

## Diwali Express Pickup — multi-merchant pickup orders (2026-10-18)

SPEC_V3 (`docs/SPEC_V3_ORDERS.md`). Renamed from Festive Diwali; guardrails rewritten in CLAUDE.md.

- **Legal gate (L1):** online ordering behind `ORDERING_ENABLED`, off by default and in prod Bicep. List-QR mode still works with it off.
- **Orders:** customers order from a merchant's catalogue; the server prices every line (offer prices) and enforces every state change (G11). Strict bodies: item ids and quantities only.
- **₹30 platform fee:** paid through the payment adapter (mock provider outside prod). Signed provider events applied once per event id. Full refund automatically when the shop doesn't confirm within 3 days (hourly job), declines, the customer cancels before confirmation, or nothing could be supplied; kept once confirmed. Admin can refund by hand.
- **Merchant:** products with photo upload (shop-media store, `/api/media`), barcode, stock, offer price and end time; orders board (confirm/decline); roles `shop_packer` and `shop_cashier` with per-role tabs and API checks.
- **Packing:** scan every unit's barcode (camera, photo or handheld scanner), atomic stock decrement, pick by hand for items without barcode, out-of-stock and alternative proposals that wait for the customer's answer, finish → per-day pack number and sticker QR (reprint rotates it).
- **Express Pickup counter:** customer's pickup QR → pack sticker must match → payment to the merchant by their own YouPI-PG UPI (create, HMAC-signed webhook, server-side status polling), card approval code, or cash with change → bill (per-shop number, licence no., safety notice) shown to the customer.
- **Gate:** marshal scans a pickup QR to direct the customer to the right shop and pack.
- **Admin:** orders and fee states, refund ₹30, merchant counter-payment settings at onboarding, metrics (orders, fees, refunds, merchant sales for reconciliation, no commission).
- **Removed:** slot booking, visits, holding bays, no-show strikes, slot generator (migration 0004). Orders schema in migration 0005.
- **Not built:** multi-level paid referral scheme (would be a money-circulation scheme); see the session notes for lawful alternatives.
- Checks: 114 unit tests, 55 integration tests (incl. concurrent last-unit scans, webhook replay/signature, QR replay/wrong pack/wrong shop, YouPI-PG against a local fake server), copy-lint, build. Walked through the full flow in the browser on the dev stack.

## Festive Diwali — full build, demo mode, premium UI, Azure deploy (2026-10-15)

Phases 1–7 of the spec, plus the rename and redesign.

- **Rename** to _Festive Diwali_ (user-facing). New premium theme: midnight plum, marigold gold, saffron and ivory; Fraunces + Manrope + Noto Sans Telugu; diya brand mark and icon.
- **Demo mode** (`DEMO_MODE=true`, forced off in prod by Bicep and by the API): "Choose a role" switcher and one-tap demo accounts on every protected screen; relaxed gate time window. Real phone + OTP sign-in is unchanged.
- **Data model**: licences, categories (two banned), items (green cert + ref required, per-item price version), price versions, slots, visits (no items or money), daily stats; `visible_shops` view (G6) and banned-category trigger (G7).
- **Customer**: shop finder (area chips, "use my location", Leaflet/OSM map, licence badge, next free slot), price list with search and categories, plan list in localStorage only (G1), walk-in list QR, slot picker (date tabs, places left, vehicle), QR ticket with bay instructions, directions, safety notice (G8) and offline copy, cancel.
- **Shop counter**: today's queue (10 s polling), scan list QR (camera via BarcodeDetector/ZXing, photo, or typed/pasted text) → pick list by rack → bill with changed-price and sold-out lines flagged → 58 mm print → mark served (code only, G1/G2; queued offline via background sync), no-show; owner tools for prices, hours/capacity per day, licence photo upload, footfall report (no money, G4).
- **Gate**: scan → valid/reason card, automatic holding-bay assignment, bay map, today's tickets.
- **Admin**: overview metrics (no-show rate, arrive→serve median), licence queue with private photo viewer, shops (live switch), grounds, categories (ban takes items off all lists), team roles, blocked numbers.
- **Jobs**: no-show sweeper with 3-strike season block, licence expiry, daily stats snapshot, slot generator, purge (daily OTP clean-up; full purge 90 days after season) + `purge:dry-run`.
- **Guardrail checks**: `pnpm copy-lint` (G5) over i18n + TSX; tests for G1 (no item tables/fields), G3 (no payment SDKs or UPI links), G4 (no money on visits), G7, G8.
- **Azure**: `infra/main.bicep` (Front Door with security headers + SPA rewrite, static website, Flex Consumption Functions locked to Front Door, Postgres 16, Key Vault refs, App Insights alerts), least-privilege DB role, OIDC deploy workflow, `docs/DEPLOY.md`. CI now also runs copy-lint and compiles the Bicep.
- **Fixes found while testing**: Drizzle-wrapped Postgres errors now map to clear 4xx codes; React effect returning `scrollTo()`'s Promise crashed the app on newer Chromium; account switches no longer leave stale screens (`queryClient.clear()` → reset); no retries on 4xx; embedded Postgres forced to UTF-8 (Telugu); grid overflow on narrow screens; demo switcher clipped; sticky bars covering focused items; Functions host now waits for the storage emulator.
- Spec deviation: admin API lives at `/api/console/*` (Functions reserves `/api/admin`). PgBouncer is not available on Burstable Postgres, so pool size × max instances is capped instead.

## Role-based access — User / Vendor / Admin (2026-10-14)

Pulls the identity parts of Phase 1 (tables) and Phase 2 (auth) forward.

- Roles: `customer` (User), `shop_owner` + `shop_staff` (Vendor, tied to one shop), `marshal` (gate, tied to a cluster), `admin`. Area rules live in `packages/shared/src/roles.ts` and are used by both API and web.
- DB (Drizzle, first migration): `users`, `consents`, `otp_requests`, `clusters`, `shops`, `shop_members`, `cluster_marshals`, `rate_limits`, `audit_log`. `users.token_version` revokes sessions on logout, delete and role change.
- API: `POST /auth/otp/request` (3/phone/10 min, 10/IP/hour), `POST /auth/otp/verify` (5 attempts, bcrypt, consent recorded), `POST /auth/logout`, `GET /me`, `DELETE /me` (G9). Session = HS256 JWT in httpOnly `pp_session` cookie, 30 days for customers, 12 h for staff; role is read from the DB on every request. `X-PP: 1` header required on all mutations (CSRF).
- Admin API `GET/POST /api/console/members` assigns roles by phone. **Spec deviation:** the Azure Functions host reserves routes beginning with `admin`, so admin endpoints use `/api/console/*` instead of `/api/admin/*`.
- Web: sign-in (phone → OTP → consent), My account (sign out, delete my data), route guard per area with "No access" page, nav shows only permitted areas, admin "Team and vendor access" screen.
- Scripts: `pnpm db:migrate`, `pnpm db:seed` (dev accounts, OTP `123456`), `pnpm --filter api admin:grant <phone>` to bootstrap the first admin.
- Tests: 20 integration tests on real Postgres (`pnpm test:int`; embedded Postgres locally, service container in CI) covering OTP happy path, wrong/expired/reused code, lockout, rate limits, CSRF, strict bodies, logout, delete-me, and 401/403/200 per role.

## Phase 0 — Scaffold (2026-10-14)

- pnpm monorepo: `apps/web`, `apps/api`, `packages/shared`; strict TypeScript, ESLint 9, Prettier, Vitest workspace.
- `apps/api`: Azure Functions v4 (Node) bundled with esbuild; `GET /api/health` pings Postgres and returns `{ok, db}` (503 when the DB is down).
- `apps/web`: Vite + React 18 + React Router 6 + TanStack Query + Tailwind 4 + i18next (English, Telugu) + PWA; placeholder customer / shop / gate / admin route areas; `/api` proxied to the Functions host.
- Local services: `docker-compose.yml` (Postgres 16 + Azurite), plus `pnpm db:embedded` fallback Postgres for machines without Docker.
- GitHub Actions CI: typecheck, lint, format check, tests, build.
