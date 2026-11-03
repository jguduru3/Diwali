# CLAUDE.md — Diwali Express Pickup

Product renamed from "Festive Diwali" (originally "Pataka Pickup") to **Diwali Express Pickup** (user-facing). Internal package names (`@pataka/shared`) and the list QR prefix `PP1` are unchanged.

Full spec: docs/SPEC.md, as amended by **docs/SPEC_V3_ORDERS.md** (v3 wins where they differ). Read both before any task. Work only on the phase I name.

## Non-negotiable guardrails (see SPEC §1 and SPEC_V3 §2)

- L1: Online ordering is behind ORDERING_ENABLED (off in prod) until a written legal opinion clears it. Plan-list mode must keep working when it is off.
- G3 (amended 2026-11-03, owner's decision): The platform collects only flat fees through the payment adapter (apps/api/src/lib/payments): the ₹30 order fee and the ₹1,999 + GST merchant subscription. Sale payments go directly to the merchant at the counter (merchant's YouPI-PG UPI, card machine, cash) and are never netted against anything. Money leaves the platform only under G13. No payment or payout SDKs in package.json (REST adapters only).
- G4: No commission or per-sale platform fee.
- G5: Banned words in UI copy: buy now, delivery, deliver, delivered, 100% legal, booking confirmed, cashback, earn money, income, guaranteed.
- G6: Public shop queries go through the `visible_shops` view only; only listed shops accept orders.
- G7 (amended 2026-11-03, owner's decision — the platform now sells groceries and other goods, not only crackers): Banned categories cannot be created or ordered. A green certificate (green_cert + green_ref) is optional; when given, the reference must be at least 2 characters.
- G8: The pickup QR screen and the bill always show the safety notice.
- G9: Customer personal data is the phone number plus an optional display name; staff see the phone masked on screen, except the printed pack sticker, which shows the customer's name and full phone (owner's decision, 2026-11-02); consent + purge + delete-me (both are cleared). Agents and influencers additionally give a name, a UPI ID and (only from ₹18,000 earned in a financial year) a PAN: UPI ID and PAN are encrypted at rest (AES-256-GCM, MERCHANT_SECRETS_KEY) with only a hash and last 4 characters in clear; they accept versioned terms before giving them; they are cleared on delete-me and anonymised by the purge job after the retention period, keeping the wallet ledger as financial records. Agents and influencers never see customer data.
- G11: The server prices orders, enforces every state change and never trusts client prices, totals, status or payment flags. QR payloads are opaque random tokens stored as hashes. Credit redemption at the counter is decided by the server, inside the payment transaction, with the customer's balance locked.
- G12: Referral and recruitment rewards are single-level, funded by the platform, and paid only on a referee's first order with the ₹30 fee captured and the pickup QR generated (packed), or on a live, paid merchant. No reward row ever references another reward row. With ordering off (L1) referrals never qualify.
- G13: Wallet credits are written only by server jobs and in-transaction rules from verified events; settlements to merchants only from credit-redemption rows; withdrawals only through the wallet endpoint with the ₹2,000 daily cap and the PAN/TDS rules. Every money row is append-only and idempotent.

If a request would break a guardrail, stop and tell me instead of implementing it.

## Stack

pnpm monorepo · TypeScript strict · Vite/React/Tailwind/TanStack Query/i18next PWA · Azure Functions v4 (Node 20) · PostgreSQL 16 + Drizzle · zod in packages/shared · Vitest, Testcontainers, Playwright · Bicep · GitHub Actions OIDC.

## Commands

- pnpm dev · pnpm test · pnpm test:int · pnpm e2e · pnpm lint · pnpm typecheck
- pnpm db:migrate · pnpm db:seed · pnpm copy-lint · pnpm i18n-lint · pnpm check · pnpm db:embedded (Postgres without Docker)
- Load: pnpm --filter api seed:load · pnpm --filter api bench:serve · node scripts/loadtest.mjs (docs/LOAD_TEST_REPORT.md)
- Demo mode (DEMO_MODE=true, never in prod): one-tap role switcher; see README.md
- Mock platform-fee payments (PAYMENT_PROVIDER=mock, refused in prod): test checkout page at /pay/mock/:id
- Mock counter UPI: merchants without YouPI-PG settings get a simulated UPI in dev/demo only

## Working rules

- TDD for shared logic (QR codes, order state machine, pricing, fee rules, webhook idempotency).
- Every API handler: zod `.strict()` body, role + membership check, audit_log on mutation.
- Payment state changes only from signature-verified provider events, applied idempotently.
- Money in integer paise; times as timestamptz, display in Asia/Kolkata.
- All UI strings in i18n/en.json and i18n/te.json — no hard-coded copy.
- Before saying a phase is done: run typecheck, lint, copy-lint, all tests, and show the output.
- Small commits with clear messages. Update CHANGELOG.md per phase.
