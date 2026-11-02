# Diwali Express Pickup — Complete Local Project Audit & E2E Verification Report

**Audit Date:** 28 October 2026  
**Auditor:** Senior Full-Stack & QA Automation Lead  
**Repository Path:** `C:\Users\chara\Diwali`  
**Git Branch:** `charan/diwali-review`  
**Git Working Tree Status:** Clean (commit `b044726`: *"Add Overview.md: platform guide, architecture, payments, API, dev notes and extension recipes"*)  
**Report Destination:** `docs/LOCAL_PROJECT_AUDIT_REPORT.md`

---

## 1. Executive Summary (For Manikanta & Platform Leadership)

A rigorous, end-to-end technical audit, baseline validation, role mapping, security review, and browser-automated verification was performed on the Diwali Express Pickup repository.

### Key Takeaways
1. **End-to-End Customer Order Journey: FULLY VERIFIED (PASS)**  
   The entire 9-step customer-to-merchant-to-counter-to-marshal journey was executed live on the local development stack with headless browser automation, real PostgreSQL persistence, and mock payments. An isolated live order was placed, priced by the server, confirmed by the merchant owner, scanned and packed item-by-item by the packer with barcode verification, verified via customer pickup QR and pack sticker QR, paid at the counter with bill generation, and verified by the gate marshal.
   - **Verified Order Reference:** `MJZ-6WA` (UUID: `c33c450a-9d41-4c9b-86f5-f48bbea84810`)
   - **Customer Pickup QR:** `DXO1.VSWTE8DX90VDN3JZH1JK13YNG1`
   - **Pack Sticker QR:** `DXK1.Q9J63RZAYKHP74PE3D1S68JKNG` (Pack #4)
   - **Generated Bill Number:** `SLC01-00002`
   - **Final Reconciled State:** `completed`, 14 atomic timeline events, zero contradictory states.
2. **Quality Gates Baseline: 100% PASSED**  
   - Typecheck: 3/3 workspace packages passed with 0 errors (`tsc -p tsconfig.json`).
   - Linting: ESLint passed with 0 errors (4 minor fast-refresh warnings in web).
   - Copy Lint (Banned Words Guardrail G5): 65 files checked, 0 violations.
   - Formatting: Prettier check clean across all files.
   - Unit Tests: 12 test files, 114 tests passed, 0 failed.
   - Integration Tests: 6 test suites, 55 integration tests passed on PostgreSQL 16.
   - Production Build: Successfully compiled API bundle (`dist/index.js` 3.6 MB) and Vite PWA frontend with service worker precache.
3. **Core Guardrails & Architecture Integrity: VERIFIED**  
   - **G3 & G4 (Fee & Anti-Commission):** Platform collects only the flat ₹30 fee via payment adapter; no payment SDKs present in `package.json`; no commission logic exists.
   - **G6 (Licence Enclosure):** Public shop queries strictly hit `visible_shops` view. Pending licence shops (`SAI01`) remain hidden until admin verification.
   - **G7 (Banned Categories):** Database triggers prevent banned cracker categories from accepting items.
   - **G8 (Safety Notice):** Exact Supreme Court safety notice rendered on customer pickup QR, list QRs, and bills.
   - **G9 (PII & Phone Privacy):** Customer phone masked to staff (`••••••` + last 4 digits); GDPR/DPDP-style `DELETE /me` anonymisation and 90-day post-season purge verified.
   - **G11 (Server Authority & QR Security):** Server prices all items from catalogue snapshots; QRs are 130-bit opaque Crockford base32 tokens stored exclusively as SHA-256 hashes.
   - **L1 (Legal Compliance Gate):** `ORDERING_ENABLED` is architecturally guarded and configured to default to `false` in production Bicep until formal legal clearance is obtained.

---

## 2. Documentation & Authoritative Specification Hierarchy

During the Phase 2 inspection, documentation evolution was analyzed:
1. **Authoritative Specification:**  
   - **`docs/SPEC_V3_ORDERS.md`** (Version 3.0 · 18 Oct 2026): Binding specification for multi-merchant pickup orders, ₹30 platform fee, packing barcode verification, Express Pickup counter, and QR formats.
   - **`Overview.md`**: Complete architectural guide and implementation handbook.
   - **`CLAUDE.md`**: Strict developer guardrails (L1, G3–G11).
2. **Superseded Documentation:**  
   - **`docs/SPEC.md`** and **`docs/TECH_GUIDE.md`**: Represent earlier V1/V2 architecture (slot booking, visit passes, holding bays, no-show strikes). Where they differ from `SPEC_V3_ORDERS.md`, V3 explicitly supersedes them. Migration `0004_remove_slots_visits.sql` formally removed visit/slot tables in favor of `0005_orders.sql`.

---

## 3. Discovered Routes, Roles, APIs, and Data Model

### 3.1 Discovered Roles
| Role | Identifier | Responsibilities & Permitted Scope |
| :--- | :--- | :--- |
| **Customer** | `customer` | Browse visible shops, review plan/order, pay ₹30 fee, answer out-of-stock/alternative questions, reveal pickup QR, view bill, cancel order, self-delete account. |
| **Merchant Owner** | `shop_owner` | Full management of assigned shop: products, prices, offers, stock, sold-out toggles, opening hours, YouPI-PG payment settings, licence upload/renewal, incoming orders confirm/reject, sales reports. |
| **Merchant Staff** | `shop_staff` | Confirm/reject orders, pack items, operate Express Pickup counter, toggle sold-out on catalogue items. Restricted from shop settings, prices, and payment configuration. |
| **Merchant Packer** | `shop_packer` | Packing portal only: open confirmed orders, scan unit barcodes, mark out-of-stock, propose alternatives, finish packing, generate pack sticker QR. Restricted from counter and settings. |
| **Merchant Cashier** | `shop_cashier`| Express Pickup counter only: scan customer QR, verify pack sticker match, initiate counter payments (YouPI-PG UPI, card terminal, cash), issue bill. Restricted from packing and settings. |
| **Gate Marshal** | `marshal` | Ground gate portal: look up customer pickup QR, verify stall location, cluster, pack number, and handover status. |
| **Platform Admin**| `admin` | Full platform administration (`/admin` UI, `/api/console/*`): onboard shops, verify licences, configure merchant YouPI settings, view all platform orders, issue manual fee refunds, review metrics. |

### 3.2 Frontend Route Inventory (`apps/web/src/router.tsx`)
- **Public & Customer:**
  - `/`: Home (shop finder, area filter, Leaflet map, licence badges)
  - `/s/:code`: Shop catalogue (categories, search, items, offer badges, stock indicators)
  - `/s/:code/plan`: Plan review & checkout (server pricing, ₹30 fee, or walk-in list QR)
  - `/orders`: Customer's orders list
  - `/orders/:id`: Order details (status timeline, fee checkout retry, out-of-stock decision UI, pickup QR with offline cache, bill view, cancellation)
  - `/pay/mock/:checkoutId`: Local mock payment checkout page
  - `/about`: Safety and platform information
  - `/login`: Phone OTP sign-in / demo one-tap switcher
  - `/account`: Profile and GDPR data deletion (`DELETE /api/me`)
- **Merchant Portal (`/shop`, guarded by `RequireRole area="shop"`):**
  - `/shop`: Orders board (Incoming, Confirmed, Completed)
  - `/shop/packing`: Packer station (barcode scanning, stock decrement, pack sticker)
  - `/shop/counter`: Express Pickup (customer QR scan -> pack scan -> payment -> bill)
  - `/shop/prices`: Product & price management (photos, barcodes, offers, stock)
  - `/shop/hours`: Opening hours configuration
  - `/shop/payments`: Merchant YouPI-PG webhook & UPI ID configuration
  - `/shop/licence`: Shop licence status and renewal upload
  - `/shop/report`: Daily sales and order volume report
- **Gate Portal (`/gate`, guarded by `RequireRole area="gate"`):**
  - `/gate`: Marshal pickup QR lookup and ground directions
- **Admin Portal (`/admin`, guarded by `RequireRole area="admin"`):**
  - `/admin`: Platform overview metrics (orders, fee revenue, refunds, sales)
  - `/admin/orders`: Platform-wide orders and fee refund controls
  - `/admin/licences`: Merchant licence verification queue
  - `/admin/shops`: Shop onboarding and status
  - `/admin/clusters`: Ground/cluster management
  - `/admin/categories`: Category management and banning triggers
  - `/admin/team`: Team & vendor role assignment
  - `/admin/blocked`: Phone blocklist management

### 3.3 Backend API Inventory (`apps/api/src/functions/`)
- **Public & Auth:**
  - `GET /api/health`: Health check (DB ping)
  - `GET /api/ordering`: Ordering status, fee amount, confirmation window
  - `GET /api/areas`, `GET /api/shops`, `GET /api/shops/{code}`, `GET /api/shops/{code}/items`: Catalogue endpoints querying `visible_shops` view
  - `GET /api/media/{*path}`: Product photos
  - `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`, `POST /api/auth/logout`: OTP authentication
  - `GET/POST /api/auth/demo`, `POST /api/auth/demo/login`: Demo switcher authentication
  - `GET/DELETE /api/me`: User profile and data deletion
- **Customer Orders:**
  - `POST /api/orders`: Place order (strict body: item IDs and quantities only)
  - `GET /api/orders/mine`, `GET /api/orders/{id}`: Customer orders
  - `POST /api/orders/{id}/fee`: Generate/reuse ₹30 fee checkout
  - `POST /api/orders/{id}/cancel`: Cancel order
  - `POST /api/orders/{id}/decisions`: Submit out-of-stock/alternative decision
  - `POST /api/orders/{id}/pickup-qr`: Reveal & rotate customer pickup QR
- **Merchant Shop Management:**
  - `GET /api/shop/context`: Shop membership context and permissions
  - `GET /api/shop/items`, `POST /api/shop/items/new`, `PATCH /api/shop/items/{id}`: Products
  - `PATCH /api/shop/items/{id}/sold-out`: Toggle sold out
  - `PUT /api/shop/settings`: Opening hours
  - `GET /api/shop/orders`, `GET /api/shop/orders/{id}`: Shop orders
  - `POST /api/shop/orders/{id}/confirm`, `POST /api/shop/orders/{id}/reject`: Order acceptance
  - `POST /api/shop/orders/{id}/start-packing`, `POST /api/shop/orders/{id}/scan`, `POST /api/shop/orders/{id}/pick`, `POST /api/shop/orders/{id}/out-of-stock`, `POST /api/shop/orders/{id}/alternate`, `POST /api/shop/orders/{id}/finish`, `POST /api/shop/orders/{id}/sticker`: Packing station
  - `POST /api/shop/counter/open`, `POST /api/shop/counter/{id}/pack`, `POST /api/shop/counter/{id}/upi`, `POST /api/shop/counter/{id}/upi-simulated`, `POST /api/shop/counter/{id}/card`, `POST /api/shop/counter/{id}/cash`: Express Pickup counter
  - `GET/PUT /api/shop/payment-settings`: Merchant YouPI-PG configuration
  - `GET /api/shop/stats`, `GET/POST /api/shop/licence`: Stats and licences
- **Gate & Console:**
  - `POST /api/gate/lookup`, `GET /api/gate/today`: Marshal operations
  - `GET/POST/PATCH /api/console/clusters*`, `shops*`, `categories*`, `licences*`, `users*`, `orders*`, `metrics`: Admin console CRUD
- **Payments & Webhooks:**
  - `POST /api/payments/webhook/{provider}`: ₹30 platform fee webhook (signature-verified)
  - `POST /api/payments/youpi/{shopCode}`: YouPI-PG counter UPI webhook
  - `GET/POST /api/payments/mock/{checkoutId}*`: Mock provider test endpoints

### 3.4 Database Schema Overview (PostgreSQL 16)
- **Core Entities:** `users`, `consents`, `otp_requests`, `clusters`, `shops`, `shop_members`, `cluster_marshals`, `shop_licences`, `categories`, `items`, `shop_price_versions`.
- **Order Engine:**
  - `orders`: Master order record (`code`, `status`, `fee_paise`, `final_total_paise`, `pack_no`, `pack_day`, `customer_qr_hash`, `pack_qr_hash`, `bill_no`, timestamps).
  - `order_lines`: Order items with unit price snapshot, picked quantity, replacement references.
  - `order_events`: Immutable audit trail for every state transition (`at`, `actor_user_id`, `type`, `meta`).
  - `fee_payments` & `fee_payment_events`: ₹30 fee attempts and unique provider event deduplication.
  - `fee_refunds`: Partial unique index (`fee_refunds_one_live`) ensuring at most one pending/processed refund per fee payment.
  - `counter_payments` & `counter_payment_events`: Direct merchant payments at the counter with unique received payment constraint per order (`counter_payments_one_received`).
  - `merchant_payment_settings`: Merchant YouPI-PG settings with AES-256-GCM encrypted webhook secrets.
  - `shop_counters`: Atomic per-shop sequential bill numbering (`SLC01-00001`).
  - `audit_log` & `rate_limits`: Mutation auditing and sliding-window rate tracking.

---

## 4. Automated Baseline Quality Checks

| Check | Command Executed | Expected Result | Actual Result | Status | Evidence / Metrics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Workspace Typecheck** | `pnpm typecheck` | 0 TypeScript errors across 3 packages | Clean exit (code 0) across `shared`, `api`, `web` | **PASS** | `packages/shared`, `apps/api`, `apps/web` typecheck done. |
| **Static Code Analysis** | `pnpm lint` | 0 ESLint errors | Clean exit (code 0), 0 errors, 4 warnings | **PASS** | 4 warnings: `react-refresh/only-export-components` in `DemoSwitcher.tsx`, `ui.tsx`, `render.tsx`. |
| **Banned Copy Words (G5)** | `pnpm copy-lint` | No banned words in UI copy | Clean exit (code 0), 65 files checked | **PASS** | `copy-lint: OK (65 files checked)`. |
| **Code Formatting** | `pnpm format:check` | All files conform to Prettier | Clean exit (code 0) | **PASS** | `All matched files use Prettier code style!`. |
| **Unit Test Suite** | `pnpm test` | All unit tests pass | 12 test files passed, 114 tests passed, 0 failed | **PASS** | Vitest 3.2.7: 114 tests passed in 19.75s. |
| **API Integration Tests** | `pnpm test:int` | All integration tests pass on PostgreSQL | 6 test files passed, 55 tests passed, 0 failed | **PASS** | Auth (14), Orders (19), RBAC (6), Catalogue (9), Operations (5), Errors (2). |
| **Production Build** | `pnpm build` | Production artifacts generated | Clean exit (code 0), API bundle + Vite PWA built | **PASS** | `apps/api/dist/index.js` (3.6 MB), `apps/web/dist` with Service Worker. |

---

## 5. End-to-End Customer Order Journey Results

The full end-to-end order journey was executed against the active local stack (`localhost:5173`, `localhost:7071`, `localhost:5432`) using headless browser automation (CDP over Chrome) and API assertions.

### Reconciled Test Order Details
- **Test Order ID:** `c33c450a-9d41-4c9b-86f5-f48bbea84810`
- **Short Reference Code:** `MJZ-6WA`
- **Customer Phone:** `+919000000099` (Demo Customer)
- **Shop Code & Name:** `SLC01` (Sri Lakshmi Crackers, Gachibowli)
- **Items Ordered:**
  1. *Electric Sparklers 10 cm* (Barcode: `8910001`, Qty: 1, Price: ₹50)
  2. *Colour Sparklers 15 cm* (Barcode: `8910002`, Qty: 2, Price: ₹90)
- **Catalogue Subtotal:** ₹230.00 (23,000 paise)
- **Platform Fee:** ₹30.00 (3,000 paise) paid online via mock checkout `mock_ck_2498925a57679ae5dd`
- **Customer Pickup QR:** `DXO1.VSWTE8DX90VDN3JZH1JK13YNG1`
- **Assigned Pack Number:** Pack #4
- **Pack Sticker QR:** `DXK1.Q9J63RZAYKHP74PE3D1S68JKNG`
- **Counter Payment:** Simulated UPI payment confirmed
- **Issued Bill Number:** `SLC01-00002`
- **Final Order Status:** `completed`

### Journey Steps Verification Matrix

| Journey Step | Actor | Action Performed | Expected Behavior | Actual Behavior Observed | Status | Captured Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Step 1: Shopping** | Customer (`...0099`) | Browse home, select `SLC01`, inspect catalogue | Shop list loads with licence badges; catalogue displays items with prices and stock | 4 listed shops displayed; SLC01 items inspected; items selected | **PASS** | Screenshots: `step1-01-home-shops.png`, `step1-02-shop-slc01.png` |
| **Step 2: Place Order** | Customer (`...0099`) | Post order to `/api/orders`, pay ₹30 via mock checkout | Order created in `fee_pending`, moves to `placed` upon fee capture; 72h deadline set | Order created; fee captured; status transitioned to `placed`; `confirm_by` set | **PASS** | Screenshot: `step2-01-customer-order-placed.png`; Order: `MJZ-6WA` |
| **Step 3: Confirm** | Merchant Owner (`...0011`)| Locate in incoming tab; confirm order | Order visible to merchant; status transitions to `confirmed`; timeline logged | Found in incoming list; confirmed; status transitioned to `confirmed` (HTTP 200) | **PASS** | Screenshot: `step3-01-merchant-orders-incoming.png` |
| **Step 4: Staff Scoping** | Merchant Staff (`...0012`)| Attempt mutations on hours, payment settings, catalogue | Staff can confirm/pack but denied access to shop settings and catalogue additions | All 3 unauthorized endpoints returned HTTP 403 Forbidden | **PASS** | API responses: 403 on `/settings`, `/payment-settings`, `/items/new` |
| **Step 5: Packing** | Packer (`...0013`) | Open order; scan wrong barcode; scan items; premature finish; finish | Transitions to `packing`; rejects wrong barcode (404); blocks early finish (409); issues pack # and QR | Barcode `8910001` & `8910002` scanned; early finish blocked (409); Pack #4 & sticker issued | **PASS** | Screenshots: `step5-01-packer-list.png`, `step5-02-packer-finished.png`; QR: `DXK1.Q9J...` |
| **Step 6: Pickup QR** | Customer (`...0099`) | Access `/orders/:id`; request pickup QR | Packed order reveals customer pickup QR (`DXO1.`); shows exact safety notice | Revealed `DXO1.VSW...`; rendered Supreme Court safety notice | **PASS** | Screenshot: `step6-01-customer-pickup-qr.png` |
| **Step 7: Counter** | Cashier (`...0014`) | Scan customer QR; scan mismatched pack; match correct pack; take UPI payment | Opens order; rejects mismatched pack (409); verifies valid pack; takes UPI; completes order; issues bill | Customer QR opened `MJZ-6WA`; wrong pack rejected (409); pack matched; UPI processed; Bill `SLC01-00002` issued | **PASS** | Screenshots: `step7-01-counter-empty.png`, `step7-02-counter-bill.png`, `step7-03-customer-bill.png` |
| **Step 8: Gate** | Marshal (`...0051`) | Scan pickup QR at gate | Identifies shop name, stall, pack #, ground matching, and collection status | Returned SLC01, Pack #4, `sameGround: true`, `status: completed`. Customer calling returned 403 | **PASS** | Screenshot: `step8-01-gate-lookup.png` |
| **Step 9: Reconciliation**| Auditor | Inspect PostgreSQL tables, foreign keys, and audit timeline | All financial, order, and event states reconcile cleanly with no duplicate payments | DB Status `completed`, Bill `SLC01-00002`, Total ₹230, Fee `captured`, Counter `received`, 14 events | **PASS** | Full DB query verification logged |

---

## 6. Verification of Additional Required Workflows

| Workflow | Actor | Scenario Tested | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pre-Confirmation Cancellation** | Customer | Cancel placed order before merchant confirmation | Status `cancelled`; automatic full ₹30 fee refund processed | Status `cancelled`; `fee_refunds` row `d115534f...` processed for ₹30 | **PASS** |
| **Post-Confirmation Cancellation** | Customer | Cancel order after merchant confirmation | Status `cancelled`; fee KEPT by platform (no refund) | Status `cancelled`; zero rows created in `fee_refunds` | **PASS** |
| **Merchant Rejection** | Shop Owner | Reject incoming placed order | Status `rejected`; automatic full ₹30 fee refund processed | Status `rejected`; `fee_refunds` row processed for ₹30 | **PASS** |
| **Alternative Product Proposal** | Packer & Customer | Item missing; propose alternative item; customer accepts | Transitions `awaiting_customer` -> customer accepts -> `packing` -> pack alternative | Workflow succeeded end-to-end; customer accepted; packer packed item; Pack #5 generated | **PASS** |
| **Admin Licence Approval** | Admin | Review pending licence for shop `SAI01` and verify | `SAI01` initially hidden; upon admin approval, enters `visible_shops` view | Verified: initially not in `visible_shops`; after approval, immediately visible | **PASS** |
| **Unconfirmed Expiry Job** | System | `orderExpiry` background job past 72h deadline | Orders past `confirm_by` expire; fee refunded automatically | Verified in integration tests (`expireUnconfirmed()` tested with time-travel) | **PASS** |

---

## 7. Security and Negative Test Findings

| Security Area | Test Performed | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CSRF Protection** | Mutating `POST /api/orders` without `X-PP: 1` header | Rejected with HTTP 403 Forbidden (`csrf`) | HTTP 403 Forbidden (`code: 'csrf'`) | **PASS** | None |
| **Cross-Shop Isolation** | Packer from shop `BAL01` attempting to scan order of `SLC01` | Rejected; cannot access or mutate foreign shop orders | HTTP 404/403 Forbidden | **PASS** | None |
| **Role-Based API Enforcement** | Customer attempting to access `/api/gate/lookup` | Rejected with HTTP 403 Forbidden | HTTP 403 Forbidden | **PASS** | None |
| **Duplicate Counter Payment** | Submitting second payment for completed order | Rejected; orders can be paid only once | HTTP 409 Conflict (`no_simulated_payment`) | **PASS** | None |
| **Mismatched QR Enforcement** | Cashier scanning pack sticker belonging to another order | Rejected with explicit error | HTTP 409 Conflict (`code: 'wrong_pack'`) | **PASS** | None |
| **QR Code Privacy** | Decoding customer pickup QR and pack sticker QR | Opaque random tokens only; no PII, items, or prices | Random Crockford base32 strings (`DXO1.`, `DXK1.`); hashes only in DB | **PASS** | None |
| **Customer Phone Privacy (G9)**| Querying shop orders via staff and cashier endpoints | Customer phone number masked | Phone rendered as `••••••` + last 4 digits | **PASS** | None |
| **SQL & Schema Injection** | Submitting extra unmodeled fields in request bodies | Zod `.strict()` validation rejects extra properties | Rejected with HTTP 400 (`invalid_body`) | **PASS** | None |

---

## 8. Defect & Limitation Inventory

During the comprehensive audit, the following findings, gaps, and environmental behaviors were recorded:

### Issue 1: Vite PWA Workbox Sandbox Permission (Build Environment)
- **Classification:** Setup & Environment Limitation
- **Severity:** Medium
- **Source File:** `apps/web/vite.config.ts`, `node_modules/workbox-build`
- **Description:** Running `pnpm build` in standard sandbox mode fails with `EPERM: operation not permitted, open 'C:\Users\chara\package.json'`. Workbox-build attempts to walk up parent directories to locate package metadata. When run with filesystem isolation bypassed, the build completes with zero errors.
- **Recommendation:** Configure Vite PWA plugin or Workbox options to explicitly set `swDest` and `globDirectory` strictly within `apps/web/dist` without traversing up to the user home directory.

### Issue 2: ESLint Fast-Refresh Warnings
- **Classification:** Code Quality / DX Warning
- **Severity:** Low
- **Source Files:**
  - `apps/web/src/components/DemoSwitcher.tsx:26:17`
  - `apps/web/src/components/ui.tsx:11:14`, `33:17`
  - `apps/web/src/test/render.tsx:8:10`
- **Description:** ESLint flags 4 warnings for `react-refresh/only-export-components` where non-component functions/constants are exported alongside React components in the same file.
- **Recommendation:** Extract helper constants and rendering utilities into separate standalone module files.

### Issue 3: Stale PostgreSQL Lock File upon Abnormal Process Termination
- **Classification:** Local Tooling & Ops
- **Severity:** Low
- **Source File:** `scripts/embedded-db.mjs`, `.pgdata/postmaster.pid`
- **Description:** If `pnpm db:embedded` is killed without a graceful SIGINT/SIGTERM, PostgreSQL leaves behind an orphaned `.pgdata/postmaster.pid` file. Subsequent attempts to run `pnpm db:embedded` fail with `FATAL: lock file "postmaster.pid" already exists` until manually removed.
- **Recommendation:** Update `scripts/embedded-db.mjs` to check whether the process ID in `postmaster.pid` is currently alive on the host; if the process does not exist, clean up the stale lock file before calling `pg.start()`.

### Issue 4: Production ₹30 Fee Payment Provider Gap
- **Classification:** Production Readiness (Known Gap)
- **Severity:** High (Production Blocker per Spec §10)
- **Source File:** `apps/api/src/lib/payments/`
- **Description:** The system currently implements only the `mock` payment provider. Production requires an adapter connecting to an RBI-authorized payment aggregator supporting automated refund webhooks.
- **Recommendation:** Implement the real payment provider adapter following the template in `apps/api/src/lib/payments/mock.ts` once aggregator commercial terms and category clearance are finalized.

### Issue 5: Customer Status Notifications (SMS / Push)
- **Classification:** Feature Gap
- **Severity:** Medium
- **Source File:** `apps/api/src/lib/counter.ts`, `apps/api/src/lib/orders.ts`
- **Description:** Customers currently must keep the web app open to observe status changes and view their pickup QR or bill. Real SMS/WhatsApp notifications via MSG91 are not yet triggered after order transitions (pending DLT template registration).
- **Recommendation:** Register DLT templates for Telangana festival notifications and integrate post-transition SMS dispatch asynchronously.

---

## 9. Comprehensive Feature & Audit Status Matrix

| Feature | Expected Result | Test Performed | Actual Result | Status | Evidence | Issue Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TypeScript Strictness** | Zero compiler errors across monorepo | `pnpm typecheck` | Clean exit (code 0) across all 3 workspaces | **PASS** | CLI output | None |
| **ESLint Analysis** | Zero linting errors | `pnpm lint` | Clean exit (code 0), 4 warnings | **PASS** | CLI output | Low |
| **Banned Words Guardrail (G5)** | No prohibited marketing copy | `pnpm copy-lint` | 65 files checked; 0 banned terms | **PASS** | CLI output | None |
| **Formatting Validation** | Full Prettier compliance | `pnpm format:check` | All files conform to Prettier | **PASS** | CLI output | None |
| **Unit Test Coverage** | Pure logic and QR tests pass | `pnpm test` | 12 test files, 114 tests passed | **PASS** | Vitest output | None |
| **Integration Test Suite** | API handlers pass on real DB | `pnpm test:int` | 6 suites, 55 tests passed | **PASS** | Vitest output | None |
| **API Health & DB Ping** | Healthcheck reports `{ok, db}` | `GET /api/health` | Returned `{"ok":true,"db":true}` | **PASS** | HTTP 200 | None |
| **Public Ordering Info** | Reports gate status and fee | `GET /api/ordering` | Returned `{enabled:true, feePaise:3000, confirmWindowHours:72}` | **PASS** | HTTP 200 | None |
| **Licence Scoping (`visible_shops`)**| Only licensed shops listed | `GET /api/shops` | 4 live shops returned; pending SAI01 omitted | **PASS** | HTTP 200 | None |
| **Customer Order Creation** | Server prices order; returns checkout | `POST /api/orders` | Order `MJZ-6WA` created in `fee_pending` | **PASS** | HTTP 201 | None |
| **Platform Fee Payment** | ₹30 captured via mock checkout | `POST /payments/mock/{id}/complete` | Payment captured; status moved to `placed` | **PASS** | HTTP 200 | None |
| **Merchant Confirmation** | Owner accepts incoming order | `POST /shop/orders/{id}/confirm`| Order transitioned to `confirmed` | **PASS** | HTTP 200 | None |
| **Staff Permission Boundary** | Staff forbidden from owner settings | `PUT /shop/settings`, `/payment-settings` | Rejected with HTTP 403 Forbidden | **PASS** | HTTP 403 | None |
| **Packing Workflow** | Scan unit barcodes; assign pack # | Barcode scan endpoints | Units scanned; premature finish rejected; Pack #4 issued | **PASS** | HTTP 200/409 | None |
| **Customer Pickup QR** | Opaque token with safety notice | `POST /orders/{id}/pickup-qr` | `DXO1.VSW...` revealed with Supreme Court notice | **PASS** | HTTP 200 | None |
| **Express Pickup Counter** | Cashier matches customer & pack QR | `POST /counter/open`, `/{id}/pack` | Wrong pack rejected (409); valid matched (200) | **PASS** | HTTP 200/409 | None |
| **Counter Payment & Bill** | Takes UPI payment; issues bill | Simulated UPI endpoints | Payment received; Bill `SLC01-00002` issued | **PASS** | HTTP 200 | None |
| **Duplicate Payment Protection** | Second payment attempt rejected | `POST /counter/{id}/upi-simulated` | Rejected with HTTP 409 (`no_simulated_payment`) | **PASS** | HTTP 409 | None |
| **Gate Marshal Verification** | Identifies shop and pack # | `POST /gate/lookup` | Returned shop name, pack #4, sameGround: true | **PASS** | HTTP 200 | None |
| **Pre-Confirmation Refund** | Customer cancel triggers ₹30 refund | `POST /orders/{id}/cancel` | Status `cancelled`; refund processed | **PASS** | HTTP 200 | None |
| **Post-Confirmation Fee Retention**| Customer cancel keeps ₹30 fee | `POST /orders/{id}/cancel` | Status `cancelled`; zero refunds issued | **PASS** | HTTP 200 | None |
| **Alternative Proposal** | Packer proposes alt; customer accepts | Alternate & decision APIs | Remainder replaced; accepted by customer | **PASS** | HTTP 200 | None |
| **Admin Licence Approval** | Approving licence makes shop live | `POST /console/licences/{id}/verify`| SAI01 added to `visible_shops` view | **PASS** | HTTP 200 | None |
| **CSRF Defense (`X-PP`)** | Mutations require CSRF header | Requests without `X-PP: 1` | Rejected with HTTP 403 Forbidden | **PASS** | HTTP 403 | None |
| **Customer Data Anonymisation** | `DELETE /me` anonymises user | Profile deletion endpoint | User record cleared; financial records kept | **PASS** | Integration test | None |
| **Production Legal Gate (L1)** | Online ordering off in prod | `ORDERING_ENABLED=false` | Guardrail test asserts gate enforcement | **PASS** | Bicep / Code | None |

---

## 10. Prioritized Next Recommendations

1. **Obtain Legal Opinion on L1 Clearance (Priority 1 — Release Blocker):**  
   Preserve `ORDERING_ENABLED=false` in production Bicep until formal written legal opinion verifies compliance with Supreme Court orders and Telangana police firecracker retail licensing conditions.
2. **Implement Production Fee Aggregator Adapter (Priority 2 — Release Blocker for Online Orders):**  
   Develop a production adapter under `apps/api/src/lib/payments/` for an RBI-authorized payment aggregator (supporting automated refund webhooks) to replace the local mock provider.
3. **Register DLT SMS Templates (Priority 3):**  
   Register standard transactional SMS templates with telecom operators for order placement, confirmation, packing, and pickup alerts to eliminate reliance on active in-app polling.
4. **Clean up ESLint Fast-Refresh Warnings (Priority 4):**  
   Separate export declarations in `DemoSwitcher.tsx`, `ui.tsx`, and `render.tsx` to ensure complete conformance with strict component-only HMR rules.
5. **Add Stale PID Cleanup in Embedded DB Script (Priority 5):**  
   Enhance `scripts/embedded-db.mjs` with an automated stale `postmaster.pid` check before startup to streamline local onboarding for new developers.

