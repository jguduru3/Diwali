# Marketplace brief — Phase 0 read-only audit

**Date:** 18 Oct 2026 · **Input:** _Diwali Marketplace Implementation & Coding Agent Instructions_ (the "brief") · **Checkout audited:** `D:\Diwali-main` (local copy, **not a git repository**)

**Outcome: stopped at the legal / payment gate (brief §3, CLAUDE.md "If a request would break a guardrail, stop and tell me").** No application code, schema, migration or test was changed. This file is the only addition.

---

## 1. Verdict in one paragraph

The brief turns Festive Diwali from a _plan list + queue token_ tool into an _online ordering + token payment + platform fee_ marketplace. Almost every brief feature (server-side orders and `order_items`, online ₹100 token, ₹30 fee, stock reservation, refunds) is exactly what this repository's guardrails G1–G5 forbid, and those guardrails exist because the Supreme Court bars e-commerce from accepting online firecracker orders (SPEC §1). The brief itself says not to weaken them for firecrackers without written legal clearance and to build the new flow **only for a legally approved category**, behind a disabled feature flag. No approved category, payment provider or legal opinion exists yet, so Phase 1 cannot start. Section 7 lists the decisions needed.

---

## 2. Brief assumptions vs. what is actually here

| Brief says / assumes                                                   | Reality in this checkout                                                                                                                                                                                                                                         | Evidence                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Repo `github.com/jguduru3/Diwali`, work on a feature branch            | Local folder is not a git repo; no remote, no branches. Branch/PR discipline cannot be followed until it is put under git                                                                                                                                        | `git` not initialised at `D:\Diwali-main`                                   |
| Read `AGENTS.md` if present                                            | Not present. `CLAUDE.md`, `docs/SPEC.md`, `docs/TECH_GUIDE.md`, `docs/DEPLOY.md` are                                                                                                                                                                             | repo root, `docs/`                                                          |
| React PWA, Vite, TS, Azure Functions, Postgres/Drizzle, shared schemas | **Confirmed**                                                                                                                                                                                                                                                    | `apps/web`, `apps/api`, `packages/shared`                                   |
| Merchant discovery by locality                                         | **Confirmed** — areas + `visible_shops` view, map, distance, next free slot                                                                                                                                                                                      | `apps/api/src/functions/public.ts`, `apps/web/src/routes/customer/Home.tsx` |
| Staff membership model                                                 | **Confirmed** — `shop_members(role in shop_owner, shop_staff)`, `cluster_marshals`                                                                                                                                                                               | `apps/api/src/db/schema.ts:121-150`, `packages/shared/src/roles.ts`         |
| Validator / packer / cashier roles                                     | **Absent.** Only `customer, shop_owner, shop_staff, marshal, admin`                                                                                                                                                                                              | `packages/shared/src/roles.ts:8`                                            |
| Inventory / stock quantities                                           | **Absent.** Items have `is_sold_out` and `is_active` only; no quantity column                                                                                                                                                                                    | `schema.ts:208-240`                                                         |
| Barcodes on items                                                      | **Absent.** Items have `item_no`, `green_ref`, `rack_code`; `BarcodeDetector` is used only to read QR codes                                                                                                                                                      | `schema.ts`, `apps/web/src/components/QrScanner.tsx`                        |
| Existing "local/demo-only order state"                                 | The **plan list** is deliberately phone-only (`localStorage` `pp.plan.<shopCode>`) and travels only inside the ticket QR                                                                                                                                         | `apps/web/src/lib/planList.ts:1`, `packages/shared/src/qr.ts`               |
| QR flows                                                               | One ticket QR: `PP1.<visit>.<shop>.<priceVer>.<items>`. It **does contain the item list** (by design, so the list never touches the server). Brief §7 forbids item lists/prices in a pickup QR — compatible only if the new pickup QR is a separate opaque token | `packages/shared/src/qr.ts`                                                 |
| Audit logging                                                          | **Confirmed** — `audit_log` written on every mutation                                                                                                                                                                                                            | `apps/api/src/lib/audit.ts`                                                 |
| Admin API at `/api/admin/*`                                            | Lives at `/api/console/*` (Functions reserves `admin`)                                                                                                                                                                                                           | `apps/api/src/functions/console.ts`, `adminMembers.ts`                      |
| `pnpm check`, `pnpm test:int`, `pnpm build`                            | **Confirmed** scripts. CI runs typecheck, lint, format, copy-lint, test, test:int, build                                                                                                                                                                         | `package.json`, `.github/workflows/ci.yml`                                  |
| Playwright end-to-end tests                                            | **Absent** — no Playwright config or specs; only Vitest unit + Testcontainers-style integration (`apps/api/test/*.int.test.ts`)                                                                                                                                  | file listing                                                                |
| Feature flags                                                          | Only env switches (`DEMO_MODE`, `OTP_DEV_MODE`, `SEASON_END`); no per-category/per-feature flag system                                                                                                                                                           | `apps/api/src/lib/env.ts`                                                   |
| Money handling                                                         | Integer paise on `items.price_paise` only; **no money anywhere on visits** (enforced by test)                                                                                                                                                                    | `schema.ts`, `apps/api/src/guardrails.test.ts`                              |

---

## 3. Architecture map (actual paths)

- **Web** `apps/web/src/router.tsx` → areas: customer (`routes/customer/*`: Home, ShopPage, PlanPage, BookPage, TicketPage), shop (`routes/shop/*`: ShopToday, Counter, Prices, Slots, Licence, Report), gate (`routes/gate/Gate.tsx`), admin (`routes/admin/*`). Guards: `auth/RequireRole.tsx`. Strings: `i18n/en.json`, `i18n/te.json`.
- **API** `apps/api/src/functions/*` — `public.ts` (areas, shops, items, slots), `auth.ts`, `me.ts`, `visits.ts`, `shop.ts`, `gate.ts`, `console.ts`, `adminMembers.ts`, `demo.ts`, `health.ts`, `timers.ts`. Helpers in `lib/` (`access.ts` role/membership, `audit.ts`, `rateLimit.ts`, `otp.ts`, `slots.ts`, `visits.ts`, `jobs.ts`, `storage.ts`).
- **DB** `apps/api/src/db/schema.ts`, migrations `0000`–`0003` in `apps/api/src/db/migrations/`. View `visible_shops`; banned-category trigger; `one_active_visit` partial unique index; atomic slot booking.
- **Jobs** `timers.ts`: noShowSweeper (5 min), licenceExpiry (hourly), dailyStats, slotGenerator, purge.
- **Shared** `packages/shared/src`: `schemas.ts` (zod, `.strict()`), `qr.ts`, `roles.ts`, `copy.ts` (banned words), `constants.ts` (`BANNED_PAYMENT_PACKAGES`), `money.ts`, `time.ts`, `phone.ts`.
- **Infra/CI** `infra/main.bicep`, `.github/workflows/{ci,deploy}.yml`.

---

## 4. Brief feature ↔ guardrail conflicts

Each row would fail an existing release-blocking check or contradict CLAUDE.md.

| Brief item                                                                      | Guardrail           | What breaks today                                                                                                                                 |
| ------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders`, `order_items`, `order_item_changes` tables; persistent server basket  | **G1/G2**           | `guardrails.test.ts` "no order/cart/booking item tables" fails on any file in `apps/api/src/db` or `packages/shared/src` containing `order_items` |
| Shop receives the list before the customer arrives (validate, substitute, pack) | **G2**              | Contradicts "list reaches the shop only by on-site QR scan"                                                                                       |
| ₹100 online token, `payments`, webhooks, provider SDK                           | **G3**              | `BANNED_PAYMENT_PACKAGES` test fails when `razorpay`/`cashfree`/etc. is added                                                                     |
| ₹30 platform fee, `platform_ledger`, settlement reports                         | **G4**              | "No commission or per-sale fees"                                                                                                                  |
| Customer copy: "order", "checkout", "place an order", refund of order           | **G5**              | `pnpm copy-lint` fails on these words in `i18n/*.json` or `.tsx`                                                                                  |
| Stock reservation, packing for later pickup                                     | SPEC §1 legal basis | Amounts to accepting an online order for firecrackers                                                                                             |

**Not in conflict** (could be built now, inside the guardrails): area discovery polish, per-item barcodes for counter scanning, finer staff permissions (validator/packer/cashier as sub-roles of `shop_staff`), an opaque expiring single-use pickup token alongside the visit code, admin exception queues for visits, reconciliation of footfall.

---

## 5. Reality check — legal and payment research (18 Oct 2026)

Secondary sources only; none of this is legal advice. Confidence noted per item.

1. **Online firecracker sales are barred.** The Supreme Court (Arjun Gopal v. UoI, 23 Oct 2018) allowed sale only through licensed traders and barred e-commerce sites from selling; violators face contempt. The direction applies across all states, not only Delhi. Enforcement continues: Gurugram (Nov 2023) barred Amazon/Flipkart from accepting firecracker orders; Mohali barred portals from "accepting or fulfilling" online orders; Delhi Police (Jul 2025) told platforms to stop online sales under threat of prosecution. I found **no 2024–2026 order relaxing this**. _Confidence: high._
2. **"Order online, collect at the licensed shop" is untested.** Explosives Rules 2008 tie retail sale to licensed premises (LE-5 / temporary festival licences). I found nothing that says a pre-paid online order collected at the shop is lawful; local orders above speak of accepting **or** fulfilling online orders. Only a written opinion can clear this. _Confidence: medium that it is high-risk; low that it is permitted._
3. **Hyderabad licensing is local and annual.** Temporary sale licences are issued by the Hyderabad/Cyberabad police commissionerate (Form AE-5), with fire and GHMC conditions; the procedure (online vs. manual) has changed between years. Current-year notice not found. _Confidence: medium._
4. **Payment aggregators.** RBI's _Regulation of Payment Aggregators Directions, 2025_ (15 Sep 2025) replace the 2020 rules; escrow debits/credits are limited to permitted purposes; non-bank PAs needed authorisation by 31 Dec 2025. Sources **disagree** on whether merchant settlement is fixed at T+1 or now set by PA–merchant agreement, and on when a marketplace collecting for sellers needs its own authorisation. Holding customer money until pickup, then splitting ₹30/₹70, is a flow-of-funds design that needs the provider's and a lawyer's sign-off, as the brief already says. _Confidence: medium; read RBI/DPSS/2025-26/141 directly._
5. **Provider capability (example: Razorpay Route).** Route supports split transfers to linked merchant accounts, holding settlements, and refunds with automatic transfer reversal (`reverse_all`) for full refunds; partial refunds across several linked accounts need manual reversal. That fits a "₹70 to merchant, ₹30 to platform, full refund on failure" model **technically**, but providers apply their own prohibited-goods lists — firecrackers/explosives commonly appear on them — so category approval must come from the provider in writing. _Confidence: medium on features, unverified on category policy._
6. **Timeline.** Pilot go-live is 29 Oct 2026 and Diwali is 8 Nov 2026 (SPEC). The brief's eight phases include provider onboarding, sandbox webhook verification and staging; that cannot realistically be done and legally cleared in 11 days. _Confidence: high._

---

## 6. If approved: proposed shape (no code yet)

Built so firecracker shops keep today's behaviour and guardrails, and the marketplace runs only for an approved category.

- **Scope switch:** add `shops.vertical` (`'firecracker' | '<approved>'`) and an env/DB feature flag `MARKETPLACE_ENABLED` defaulting off. Ordering endpoints return 404 unless both the flag is on and the shop's vertical is approved. Firecracker shops can never enter the order flow (test).
- **Guardrail tests change from global to scoped** — this needs your explicit sign-off because it edits release blockers: G1/G4 keep applying to `visits` and the plan-list QR; new tests assert no firecracker shop can have an order. G3 allows exactly one approved provider SDK, server-side only. G5 copy-lint gets a separate allow-list for the marketplace screens only.
- **New module, additive migrations (`0004+`):** `orders`, `order_lines`, `order_line_changes`, `order_events`, `inventory_movements`, `payments`, `refunds`, `pickup_tokens` (hash only), `platform_ledger`; `items.stock_qty`, `items.barcode`. All paise integers, `timestamptz`.
- **Server state machine** in `packages/shared/src/orderState.ts` (TDD), transitions only via handlers; stock reservation with `UPDATE … WHERE stock_qty >= $n` in one transaction (same pattern as slot booking).
- **Roles:** `shop_members.role` gains `shop_validator`, `shop_packer`, `shop_cashier` (still Vendor area), checked in `lib/access.ts`.
- **Payments:** webhook handler with signature check and `idempotency_key` unique index; fee row in `platform_ledger` written in the same transaction as collection, unique per order.
- **Pickup token:** 128-bit random, stored as SHA-256, bound to order + shop, `expires_at`, `consumed_at` set via `UPDATE … WHERE consumed_at IS NULL`.
- **Tests to add:** Playwright (not present today), concurrency (last unit), webhook replay, QR replay/wrong shop, event close.

File-by-file plan per phase will be written once the category and provider are known; it depends on both.

---

## 7. Decisions needed before Phase 1

1. **Which product category is legally approved** for online ordering + token payment? (Firecrackers are not, on current evidence.) Who signed the opinion?
2. **May the release-blocking guardrail tests be scoped** (section 6) so they still protect firecracker shops but allow a separate marketplace module?
3. **Payment provider** and its written confirmation of: the category, holding funds until pickup, ₹70/₹30 split, full-refund reversal, settlement timing under the RBI 2025 Directions.
4. **Timing:** is the marketplace for this Diwali (pilot 29 Oct) or a later season? The audit recommends shipping the current pilot unchanged and building the marketplace for an approved category afterwards.
5. **Repository:** put this folder under git (or work in a clone of `jguduru3/Diwali`) so phases can go on a feature branch with reviewable diffs.

## 8. Risk register

| Risk                                                           | Likelihood                     | Impact | Mitigation                                                                          |
| -------------------------------------------------------------- | ------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| Contempt / prosecution for accepting online firecracker orders | High if built for firecrackers | Severe | Do not enable for firecracker vertical; written legal opinion                       |
| Provider refuses category or freezes account                   | Medium                         | High   | Written category approval before integration                                        |
| Holding customer funds without authorisation (RBI PA rules)    | Medium                         | High   | Provider-held split/escrow only; legal review of flow of funds                      |
| Weakening guardrails leaks into the firecracker flow           | Medium                         | Severe | Vertical switch + flag + scoped tests that fail if a firecracker shop gets an order |
| Schedule collision with 29 Oct pilot                           | High                           | High   | Freeze pilot; marketplace on a branch for a later date                              |
| No git history → unreviewable large diff                       | Certain today                  | Medium | Initialise git / use remote clone before Phase 1                                    |
| No e2e tests                                                   | Certain today                  | Medium | Add Playwright in Phase 8 (or earlier for the pilot)                                |

## Sources

- Supreme Court 2018 order: [LiveLaw](https://www.livelaw.in/sc-refuses-complete-ban-on-sale-of-firecrackers), [Business Standard](https://www.business-standard.com/article/pti-stories/sc-restrains-e-commerce-sites-from-selling-firecrackers-online-118102301258_1.html), [LiveLaw — applies to all states](https://www.livelaw.in/top-stories/directions-regulating-firecrackers-apply-to-all-states-in-country-not-just-delhi-supreme-court-241796)
- Enforcement: [Delhi Police, Jul 2025 (News on AIR)](https://www.newsonair.gov.in/delhi-police-urges-social-media-e-commerce-platforms-for-immediate-cessation-of-online-sale-of-firecrackers), [Mohali (Tribune)](https://www.tribuneindia.com/news/chandigarh/mohali-imposes-strict-firecracker-curbs-ecommerce-portals-prohibited-from-accepting-online-orders), [Gurugram (Deccan Herald)](https://www.deccanherald.com/india/haryana/ban-on-firecrackers-in-gurugram-from-november-green-crackers-allowed-on-diwali-2705337)
- Explosives Rules / licensing: [Explosives Rules 2008 (Indian Kanoon)](https://indiankanoon.org/doc/60892116/), [PESO FAQ](https://www.peso.gov.in/sites/default/files/2024-08/Revised%20FAQ%20ER%202008%20AN%202012.pdf), [Hyderabad licence procedure (Siasat)](https://www.siasat.com/hyderabad-police-announce-application-procedure-for-firecracker-sale-license-3111283/amp/), [Sakshi Post](https://www.sakshipost.com/news/hyderabad/hyderabad-firecracker-traders-must-apply-temporary-license-145379)
- RBI PA Directions 2025: [TaxGuru](https://taxguru.in/rbi/rbi-regulation-payment-aggregators-directions-2025.html), [MediaNama](https://www.medianama.com/2025/09/223-explained-rbi-master-direction-payment-aggregators/), [AZB](https://www.azbpartners.com/bank/rbi-issues-consolidated-reserve-bank-of-india-regulation-of-payment-aggregators-directions-2025/), [Legal500](https://www.legal500.com/intelligence/india/finance-and-banking/rbi-master-directions-2025-compliance-and-operational-challenges-for-payment-aggregators)
- Razorpay Route: [Refunds](https://razorpay.com/docs/payments/route/refund), [Reversals](https://razorpay.com/docs/payments/route/reversal.md), [Refund + reverse transfer API](https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer.md)
