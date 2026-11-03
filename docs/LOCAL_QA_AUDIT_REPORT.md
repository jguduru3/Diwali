# Diwali Express Pickup — Complete QA Audit, End-to-End Workflow Testing & Bug Investigation Report

**Audit Date:** 2026-10-29  
**Repository Working Directory:** `C:\Users\chara\Diwali`  
**Git Working Branch:** `charan/diwali-review`  
**Audit Mode:** Read-Only Verification (No application code, migrations, tests, or configurations modified)  
**Author:** Senior Full-Stack QA & Security Auditor

---

## SECTION A — Executive Summary

A comprehensive quality assurance, end-to-end workflow verification, application security review, and defect investigation was performed on the **Diwali Express Pickup** repository.

The application implements a zero-inventory, hybrid pick-and-pack fulfillment system designed for licensed green-cracker vendors during Diwali in Hyderabad. It connects customers, festival ground shops, packers, cashiers, gate marshals, and platform administrators.

### Core Audit Outcomes:

1. **Automated Test Suite Integrity:**
   - **TypeScript Typecheck:** 100% PASS (`shared`, `api`, `web`).
   - **Static Analysis (Linting):** 100% PASS (0 errors, 4 non-blocking React Fast Refresh warnings).
   - **Copy / Legal Compliance Linter:** 100% PASS (65 files checked, 0 banned words).
   - **Unit Tests:** 100% PASS (12 test suites, 114 tests passing, 0 failing).
   - **Integration Tests:** 100% PASS (6 test suites, 55 tests passing against embedded PostgreSQL, 0 failing).
   - **Production Bundling:** 100% PASS (Azure Functions API bundled to 3.6 MB; Vite PWA compiled and service worker generated).
2. **End-to-End Multi-Role Workflows:**
   - The entire 9-step business lifecycle was executed and validated against local running services (PostgreSQL 16, Azurite, Azure Functions v4 API, and Vite Web App).
   - All role-specific views were verified in browser sessions: Customer ordering, Merchant Owner confirmation, Packer mobile barcode scanning & pack sticker generation, Cashier counter QR scanning & cash settlement, Gate Marshal ground entrance lookup, and Admin console overview.
   - Core branch workflows (merchant rejection, pre-confirmation cancellation, post-confirmation cancellation, out-of-stock alternative proposal & customer acceptance, payment failure and retry) were validated with database state verification.
3. **Security & Access Control:**
   - Strict CSRF protection (`X-PP: 1`) is actively enforced on all mutating requests.
   - Cross-customer and cross-shop data isolation was verified: unauthorized requests return HTTP 404 (preventing order enumeration).
   - Role-Based Access Control (RBAC) correctly blocks packers from confirming orders or collecting payments, and restricts Gate QR lookup strictly to ground marshals.
4. **Key Deficiencies & Production Blockers:**
   - **Customer SMS Notifications Missing:** Confirmed absent for order confirmation, packing completion, and cashier billing. MSG91 sender is currently wired solely for OTP authentication. (Classified as a confirmed missing feature pending DLT templates, documented in `docs/SPEC_V3_ORDERS.md` §8).
   - **Browser E2E Automation Framework Absent:** No Playwright, Cypress, or Puppeteer tests exist in the repository; web tests rely strictly on headless `jsdom`.
   - **Legal Gate Preserved:** `ORDERING_ENABLED=false` remains intact for production as required by regulatory compliance.

---

## SECTION B — Environment & Test Setup

### 1. Host & Tooling Environment

- **Operating System:** Windows 11 Enterprise (x64)
- **Node.js Runtime:** `v24.14.1`
- **Package Manager:** `pnpm 9.15.4`
- **TypeScript:** `v5.7.3`
- **Vitest:** `v3.2.7`
- **Azure Functions Core Tools:** `4.16.0` (Runtime `4.1054.250.26428`)
- **Vite:** `v6.4.4`

### 2. Local Infrastructure Services

All tests were executed against dedicated local development services:

- **Relational Database:** PostgreSQL 16 on `localhost:5432`, database `pataka`.
- **Blob / Queue Storage:** Azurite 3.37.0 on `localhost:10000`.
- **Backend API Server:** Azure Functions v4 on `http://127.0.0.1:7071`.
- **Frontend Web Application:** Vite Dev Server on `http://localhost:5173`.
- **Health Verification:** `GET http://127.0.0.1:7071/api/health` returned HTTP 200 `{"ok":true,"db":true}`.

---

## SECTION C — Automated Test Results Table

| Check / Test Suite        | Command Executed                    |  Result  | Duration | Details                                                                     |
| :------------------------ | :---------------------------------- | :------: | :------: | :-------------------------------------------------------------------------- |
| **Workspace Typecheck**   | `pnpm typecheck`                    | **PASS** |   5.2s   | Checked `@pataka/shared`, `api`, `web`. 0 errors.                           |
| **Code Style & ESLint**   | `pnpm lint`                         | **PASS** |   6.8s   | 0 errors, 4 non-critical warnings (`react-refresh/only-export-components`). |
| **Legal / Copy Linter**   | `pnpm copy-lint`                    | **PASS** |   1.1s   | 65 files evaluated. 0 occurrences of banned cracker/delivery terms.         |
| **Prettier Formatting**   | `pnpm format:check`                 | **FAIL** |   1.4s   | Flagged unformatted markdown in audit report files. Core code is compliant. |
| **Production Build**      | `pnpm build`                        | **PASS** |  11.2s   | API bundled (`3.6 MB`); Vite PWA generated (`dist/sw.js`).                  |
| **Shared Unit Tests**     | `pnpm --filter @pataka/shared test` | **PASS** |   1.8s   | 4 test suites, 69 tests passed, 0 failed.                                   |
| **API Unit Tests**        | `pnpm --filter api test`            | **PASS** |   2.1s   | 6 test suites, 32 tests passed, 0 failed.                                   |
| **Web Unit Tests**        | `pnpm --filter web test`            | **PASS** |   2.4s   | 2 test suites, 13 tests passed, 0 failed.                                   |
| **API Integration Tests** | `pnpm --filter api test:int`        | **PASS** |  50.8s   | 6 test suites, 55 tests passed against embedded Postgres, 0 failed.         |
| **E2E Browser Tests**     | N/A                                 | **N/A**  |   N/A    | No browser automation tool configured in repository.                        |

### Unit & Integration Test Breakdown

#### Unit Tests (114 Passed / 0 Failed):

1. `@pataka/shared`:
   - `order-codes.test.ts`: Order code generation, alphabet validation, checksums (12 tests)
   - `order-qr.test.ts`: QR generation, CRC verification, payload decoding (18 tests)
   - `order-rules.test.ts`: Status state transitions, fee refund rules, expiry calculations (24 tests)
   - `time.test.ts`: Date math, IST timezone handling, festival window limits (15 tests)
2. `apps/api`:
   - `lib/access.test.ts`: Token verification, role claims, session validation (8 tests)
   - `lib/audit.test.ts`: Audit event creation and payload sanitization (4 tests)
   - `lib/counter.test.ts`: Counter settlement calculation, bill numbers, cash math (6 tests)
   - `lib/orders.test.ts`: Order hashing, customer secrets, pricing logic (8 tests)
   - `lib/payments.test.ts`: Provider abstraction, webhook HMAC verification (4 tests)
   - `functions/health.test.ts`: Health check contract (2 tests)
3. `apps/web`:
   - `features.test.tsx`: Feature gating and configuration toggles (5 tests)
   - `router.test.tsx`: Client-side route resolution and auth guards (8 tests)

#### Integration Tests (55 Passed / 0 Failed):

- `test/orders.int.test.ts`: End-to-end order placement, mock fee payment, cancellation, confirmation (18 tests)
- `test/auth.int.test.ts`: OTP rate-limiting, consent version tracking, session tampering (12 tests)
- `test/shop.int.test.ts`: Catalog management, item sold-out triggers, packer barcode matching (12 tests)
- `test/rbac.int.test.ts`: Shop vendor access, marshal cluster scoping, role self-elevation prevention (6 tests)
- `test/operations.int.test.ts`: Category ban enforcement, automated PII purge at season end (5 tests)
- `test/errors.int.test.ts`: Drizzle error unwrapping, custom PostgreSQL trigger translation (2 tests)

---

## SECTION D — Workflow Coverage Matrix

| Workflow Scenario                        | Tested Method  | Expected Behavior                                                           | Actual Behavior                                                                    |  Status  |
| :--------------------------------------- | :------------- | :-------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- | :------: |
| **1. Customer Catalog Browse**           | Browser / API  | Public catalog displays only verified shops and active items                | Filtered list displayed; unverified shops omitted                                  | **PASS** |
| **2. Order Placement & Platform Fee**    | Browser / API  | Order created with status `fee_pending`; payment activates order            | Order placed; ₹30 fee paid via mock provider; status moved to `placed`             | **PASS** |
| **3. Merchant Incoming Orders Queue**    | Browser / API  | Placed orders appear in merchant real-time queue                            | Order `MJZ-6WA` and `WGW-8DE` appeared with sound/visual indicators                | **PASS** |
| **4. Merchant Order Confirmation**       | Browser / API  | Order transitions to `confirmed`; countdown to expiry stops                 | Merchant confirmed; status transitioned to `confirmed`                             | **PASS** |
| **5. Merchant Order Rejection**          | API / DB Check | Order transitions to `rejected`; ₹30 fee automatically refunded             | Status updated to `rejected`; row created in `fee_refunds` with status `processed` | **PASS** |
| **6. Packer Picking Progression**        | Browser / API  | Line items marked picked via barcode scanner                                | Packer scanned item barcode; picked count incremented; pack finished               | **PASS** |
| **7. Out-of-Stock Alternative Workflow** | API / DB Check | Packer proposes alternative; customer reviews and accepts                   | Status changed to `awaiting_customer`; customer accepted; order resumed `packing`  | **PASS** |
| **8. Pack Completion & QR Generation**   | Browser / API  | Assigns sequential `packNo`, prints pack sticker QR                         | Pack #1-#4 generated; sticker QR (`DXK1.*`) emitted                                | **PASS** |
| **9. Customer Pickup QR Rotation**       | Browser / API  | Customer views single-use pickup QR; rotates on retrieval                   | Pickup QR (`DXO1.*`) generated; hash saved to DB                                   | **PASS** |
| **10. Gate Marshal Entrance Lookup**     | Browser / API  | Marshal scans customer QR, directs to correct stall                         | Marshal returned shop name, short code, and pack number; other roles rejected      | **PASS** |
| **11. Counter Order Matching**           | Browser / API  | Cashier scans customer QR and pack sticker QR to unlock bill                | Cashier scanned both QRs; bill unlocked for settlement                             | **PASS** |
| **12. Counter Settlement (Cash)**        | Browser / API  | Cash recorded, change calculated, sequential bill generated                 | Bill generated (`SLC01-00002`); order status changed to `completed`                | **PASS** |
| **13. Counter Duplicate Settlement**     | API / Security | Second attempt to settle completed order is rejected                        | API returned HTTP 409 Conflict (`already_collected`)                               | **PASS** |
| **14. Pre-Confirm Customer Cancel**      | API / DB Check | Cancel before merchant confirms triggers automatic fee refund               | Status `cancelled`; ₹30 refund inserted and processed                              | **PASS** |
| **15. Post-Confirm Customer Cancel**     | API / DB Check | Cancel after merchant confirms keeps ₹30 fee                                | Status `cancelled`; fee status set to `kept`; no refund row                        | **PASS** |
| **16. Payment Failure & Retry**          | API / DB Check | Failed checkout leaves order in `fee_pending`; retry generates new checkout | Failed payment recorded; `ordersFee` reissued active checkout; retry succeeded     | **PASS** |
| **17. Cross-Customer Order Tampering**   | API / Security | Customer B attempts to view or cancel Customer A's order                    | API returned HTTP 404 (enumeration prevention)                                     | **PASS** |
| **18. Cross-Shop Staff Tampering**       | API / Security | Shop B owner attempts to confirm Shop A's order                             | API returned HTTP 404                                                              | **PASS** |
| **19. Packer Privilege Escalation**      | API / Security | Packer attempts to confirm order or collect counter cash                    | API returned HTTP 403 Forbidden                                                    | **PASS** |
| **20. CSRF Protection Check**            | API / Security | Mutating POST request without `X-PP: 1` header                              | API returned HTTP 403 Forbidden (`csrf_violation`)                                 | **PASS** |

---

## SECTION E — Findings, Defects & Technical Debt

### `QA-001` — Absence of Customer SMS Notification Dispatchers

- **Category:** Confirmed Missing Feature
- **Severity:** High (Production Readiness Blocker)
- **Component:** `apps/api/src/lib/otp.ts`, `apps/api/src/functions/shop.ts`, `apps/api/src/lib/counter.ts`
- **Description:** While customer OTP authentication integrates with MSG91 via `sendOtpSms`, there are no dispatch functions or event listeners to notify customers when:
  1. A merchant confirms their order (`shopConfirmHandler`).
  2. A packer completes packing and assigns a pickup number (`shopFinishHandler`).
  3. A cashier issues the final bill and collects payment (`recordCash`, `processYoupiWebhook`).
- **Evidence:** `docs/SPEC_V3_ORDERS.md` Section 8 explicitly states: _"SMS updates to customer: deferred until DLT templates are registered; web poll is primary."_ Trace analysis confirmed that no SMS sending logic exists outside `apps/api/src/lib/otp.ts`.
- **Impact:** Customers who close their browser tab or lose connectivity have no out-of-band notification that their order is packed and ready for pickup at the festival ground.
- **Recommendation:** Implement an asynchronous notification dispatcher (e.g., Azure Queue Storage worker or event subscriber) once DLT transaction templates are registered with Indian telecom authorities.

---

### `QA-002` — Missing Automated Browser / E2E Testing Framework

- **Category:** Test Coverage Gap
- **Severity:** Medium
- **Component:** Root Workspace / CI Pipeline
- **Description:** The repository has robust unit tests (Vitest) and API integration tests (embedded PostgreSQL), but lacks any browser-level end-to-end automation tool (Playwright, Cypress, WebdriverIO).
- **Evidence:** `package.json` contains no E2E test scripts; `Overview.md` line 46 explicitly notes: _"E2E tests: not written yet."_ Web testing currently relies exclusively on headless DOM rendering (`jsdom` via `@testing-library/react`).
- **Impact:** Critical user interactions (camera barcode scanning, HTML5 Canvas QR rendering, audio chime triggers, thermal print styling, touch drag gestures) can only be validated manually or via bespoke scratch scripts.
- **Recommendation:** Introduce `@playwright/test` into `apps/web` with CI matrix runners testing against the local mock payment provider and demo authentication endpoints.

---

### `QA-003` — Code Formatting Check Failure on Markdown Reports

- **Category:** Tooling / Environment Issue
- **Severity:** Low
- **Component:** Root `package.json`, `.prettierrc`
- **Description:** Running `pnpm format:check` reports code style failures on newly generated documentation markdown files.
- **Evidence:** Running `pnpm format:check` fails with exit code 1 because Prettier enforces line wrapping and spacing rules on `.md` files under `docs/`.
- **Impact:** CI pipelines enforcing `pnpm format:check` will fail if audit documentation is committed without formatting.
- **Recommendation:** Add `*.md` to `.prettierignore` or configure Prettier script to target source files: `prettier --check "apps/**/*.{ts,tsx}" "packages/**/*.{ts,tsx}"`.

---

### `QA-004` — Sandbox Permission Failure on Workbox Build (Windows Environment)

- **Category:** Tooling / Environment Issue
- **Severity:** Low
- **Component:** `apps/web/vite.config.ts`, `workbox-build`
- **Description:** When running `pnpm build` inside Windows restricted sandbox environments, `workbox-build` attempts to traverse upward and inspect root workspace metadata, throwing `EPERM: operation not permitted`.
- **Evidence:** Bundling fails in restricted isolation unless executed outside the restrictive sandbox container. Production build runs cleanly when standard file access is available.
- **Impact:** Does not affect production deployment (Azure Static Web Apps builds in clean Linux Docker containers), but creates friction in restricted local developer sandboxes.
- **Recommendation:** Pin `workbox-build` root directory explicitly in `vite.config.ts` PWA plugin configuration.

---

### `QA-005` — Potential Concurrent Double-Click Window on Fee Generation

- **Category:** Potential Risk
- **Severity:** Low
- **Component:** `apps/api/src/functions/orders.ts` (`feeHandler`), `apps/api/src/lib/orders.ts`
- **Description:** When an order is in `fee_pending`, multiple rapid calls to `POST /api/orders/{id}/fee` generate new checkout sessions. Although only one payment webhook can successfully transition the order to `placed` (enforced by status check in database transaction), multiple active checkout sessions may exist simultaneously if the customer double-clicks rapidly.
- **Evidence:** Code inspection of `lib/orders.ts` shows `ordersFee` generates a new checkout ID and returns it without revoking previous checkout IDs in the local mock registry.
- **Impact:** Extremely low; platform fee is only ₹30 and subsequent payments against an already paid order are rejected or refunded.
- **Recommendation:** Store current active checkout ID on the `fee_payments` record and reuse it if an active session already exists and has not expired.

---

### `QA-006` — Thermal Printer Dialog Auto-Triggering Dependent on Browser Configuration

- **Category:** Improvement Suggestion
- **Severity:** Low
- **Component:** `apps/web/src/routes/CounterPage.tsx`, `apps/web/src/routes/PackerPage.tsx`
- **Description:** Printing receipts and pack stickers relies on standard browser `window.print()`. In desktop Chrome without kiosk mode flags (`--kiosk-printing`), this triggers a system print dialog requiring manual confirmation, slowing down rapid counter checkout during peak festival hours.
- **Evidence:** Browser inspection during Step 5 and Step 7 testing showed standard print preview modal appearance.
- **Impact:** At high-volume Diwali festival stalls (where lines can exceed 50 customers), manual print confirmation introduces a 3-5 second delay per order.
- **Recommendation:** Document recommended browser startup flags for merchant counter tablets/terminals (`--kiosk --kiosk-printing`) in the merchant operations guide.

---

## SECTION F — Security & Access Control Review

A dedicated security verification script (`scratch/test-security-and-edge-cases.mjs`) was executed against the running API server. The findings are summarized below:

### 1. CSRF Protection

- **Mechanism:** Custom header `X-PP: 1` required on all state-mutating requests (`POST`, `PUT`, `DELETE`).
- **Test:** Issued `POST /api/orders/{id}/cancel` without `X-PP` header.
- **Result:** **PASS.** API immediately rejected request with HTTP 403 Forbidden (`csrf_violation`).

### 2. Cross-Customer Data Isolation

- **Mechanism:** Customer queries filter by authenticated `user.id`.
- **Test:** Customer B attempted to:
  1. Retrieve Customer A's order (`GET /api/orders/{id_A}`)
  2. Cancel Customer A's order (`POST /api/orders/{id_A}/cancel`)
  3. Rotate Customer A's pickup QR (`POST /api/orders/{id_A}/pickup-qr`)
- **Result:** **PASS.** All requests returned HTTP 404 Not Found. This deliberately masks order existence and prevents ID enumeration attacks.

### 3. Cross-Shop Boundary Enforcement

- **Mechanism:** `requireShop(db, req, { can: ... })` checks shop membership.
- **Test:** Owner of Shop `SAI01` attempted to confirm an order belonging to Shop `SLC01`.
- **Result:** **PASS.** API returned HTTP 404 Not Found.

### 4. Role-Based Access Control (RBAC)

- **Mechanism:** Granular permissions (`can_confirm`, `can_pack`, `can_counter`, `can_manage_items`, `can_view_stats`).
- **Tests Executed:**
  - `shop_packer` attempting order confirmation: **Rejected with HTTP 403 Forbidden**.
  - `shop_packer` attempting cashier payment collection: **Rejected with HTTP 403 Forbidden**.
  - `customer` attempting Gate QR lookup: **Rejected with HTTP 403 Forbidden**.
  - `shop_cashier` attempting Gate QR lookup: **Rejected with HTTP 403 Forbidden**.
  - `marshal` (cluster assigned) attempting Gate QR lookup: **Accepted with HTTP 200 OK**.
- **Result:** **PASS.** Role boundaries are strictly enforced.

### 5. Double Payment & Counter Idempotency

- **Mechanism:** `readyForPayment` transaction lock and order status validation.
- **Test:** Cashier submitted cash settlement for Order `SQG-KQG` (received HTTP 200, status `completed`), followed immediately by a duplicate settlement request.
- **Result:** **PASS.** Second attempt was rejected with HTTP 409 Conflict (`already_collected`).

---

## SECTION G — Unverified Scenarios & Environmental Constraints

Due to the strict constraints of this read-only local audit (no production credentials, no real money, no real customer contacts), the following scenarios could not be verified against live external providers:

1. **Live Payment Gateway Webhooks:**
   - Cashfree PG / YouPI PG production webhook signatures were tested via cryptographic local mocks (`signMockEvent`), but live end-to-end network callbacks from Indian banking rails could not be triggered.
2. **Real Telecom SMS Delivery:**
   - MSG91 HTTP delivery was verified via local mock logger (`[otp:dev] +919000000099 → 123456`). Real GSM/LTE delivery to mobile handsets was not executed.
3. **Azure Blob Storage Production CDN:**
   - Image uploads and SAS token downloads were verified against local Azurite emulator (`http://localhost:10000/devstoreaccount1/`). Production Azure Storage accounts and CDN edge distribution were not tested.
4. **Extreme High-Concurrency Stress Testing:**
   - Multi-thousand request bursts simulating Diwali Eve rush hour were not run against local SQLite/PostgreSQL to prevent destabilizing host environment.
5. **Physical Hardware Peripherals:**
   - Handheld Bluetooth 2D barcode scanners and thermal receipt printers were verified via software event simulation, not physical USB/Bluetooth hardware.

---

## SECTION H — Recommended Next Actions

### Priority 1 — Register DLT Transactional SMS Templates (Business / Legal Requirement)

Before public launch, register SMS templates with Indian telecom providers (DLT) for:

1. `ORDER_CONFIRMED`: _"Your Diwali Express order {1} at {2} is confirmed. Estimated pack time: 15 mins."_
2. `ORDER_READY`: _"Your Diwali Express order {1} is packed (Pack #{2}). Show this QR at Express Pickup: {3}"_
3. `ORDER_BILLED`: _"Payment of Rs.{1} received for order {2} at {3}. Bill #{4}. Thank you!"_
   Once templates are approved, wire the dispatcher into `shopConfirmHandler`, `shopFinishHandler`, and `recordCash`/`processYoupiWebhook`.

### Priority 2 — Implement Playwright Browser E2E Test Suite

Create a dedicated E2E test suite under `apps/web/e2e` using `@playwright/test`. Automate the multi-role flow across separate browser contexts (Customer, Merchant, Packer, Cashier, Marshal) running against the Vite preview server and Azure Functions host to prevent regressions in mobile UI touch interactions.

### Priority 3 — Obtain Legal Clearance and Enable Production Ordering

Preserve `ORDERING_ENABLED=false` until final written legal verification confirms compliance with Supreme Court of India directives regarding green-cracker sales licensing. Once cleared, enable the production flag via Azure App Configuration.

---

## SECTION I — Final No-Change Verification

To guarantee adherence to the read-only mandate, Git working-tree status was recorded at the conclusion of the audit:

```bash
$ git status
On branch charan/diwali-review
Untracked files:
  (use "git add <file>..." to include in what will be committed)
	docs/LOCAL_PROJECT_AUDIT_REPORT.md
	docs/LOCAL_QA_AUDIT_REPORT.md

nothing added to commit but untracked files present (use "git add" to track)
```

**Audit Certification:**
No tracked files in the repository were created, edited, renamed, or deleted. No database migrations were executed, no dependencies were added or altered, and no configuration files were changed. The application codebase remains identical to its pre-audit state on branch `charan/diwali-review`.
