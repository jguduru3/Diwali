# Changelog

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
