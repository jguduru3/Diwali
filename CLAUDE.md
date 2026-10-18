# CLAUDE.md — Diwali Express Pickup

Product renamed from "Festive Diwali" (originally "Pataka Pickup") to **Diwali Express Pickup** (user-facing). Internal package names (`@pataka/shared`) and the list QR prefix `PP1` are unchanged.

Full spec: docs/SPEC.md, as amended by **docs/SPEC_V2_EXPRESS_PASS.md** (v2 wins where they differ). Read both before any task. Work only on the phase I name.

## Non-negotiable guardrails (see SPEC §1 and SPEC_V2 §2)

- G1/G2: Never store, send or accept item lists server-side. Plan lists live in localStorage and the list QR only. No order_items/cart/booking_items tables or fields.
- G3: No payment for goods online. The only online payment is the flat platform **Express Pass fee** (₹30), collected through the payment-provider adapter (`apps/api/src/lib/payments`). No payment SDKs in package.json, no UPI links in our code, no wallets. Paid passes stay off (`PASSES_ENABLED=false`) in prod until the Telangana compliance review signs off.
- G4: No commission or per-sale fees; never record sale amounts. The pass fee is flat and independent of what is bought. No money fields on scans or shops.
- G5: Banned words in UI copy: order, reserve, reservation, cart, checkout, buy now, booking confirmed, delivery, 100% legal.
- G6: Public shop queries go through the `visible_shops` view only.
- G7: Banned categories cannot be created; every item needs green_cert + green_ref.
- G8: The pass and the list QR screen always show the safety notice.
- G9: Phone number is the only personal data; consent + purge + delete-me. Shops see only a masked number.
- G10: The pass verifies the customer only. It never reserves stock, guarantees availability or confirms a purchase, and the pass screen says so.

If a request would break a guardrail, stop and tell me instead of implementing it.

## Stack

pnpm monorepo · TypeScript strict · Vite/React/Tailwind/TanStack Query/i18next PWA · Azure Functions v4 (Node 20) · PostgreSQL 16 + Drizzle · zod in packages/shared · Vitest, Testcontainers, Playwright · Bicep · GitHub Actions OIDC.

## Commands

- pnpm dev · pnpm test · pnpm test:int · pnpm e2e · pnpm lint · pnpm typecheck
- pnpm db:migrate · pnpm db:seed · pnpm copy-lint · pnpm check · pnpm db:embedded (Postgres without Docker)
- Demo mode (DEMO_MODE=true, never in prod): one-tap role switcher; see README.md
- Mock payments (PAYMENT_PROVIDER=mock, refused in prod): test checkout page at /pay/mock/:id

## Working rules

- TDD for shared logic (QR codec, pass codes, pass validity, scan flagging, webhook idempotency).
- Every API handler: zod `.strict()` body, role + membership check, audit_log on mutation.
- Payment state changes only from signature-verified provider events, applied idempotently.
- Money in integer paise; times as timestamptz, display in Asia/Kolkata.
- All UI strings in i18n/en.json and i18n/te.json — no hard-coded copy.
- Before saying a phase is done: run typecheck, lint, copy-lint, all tests, and show the output.
- Small commits with clear messages. Update CHANGELOG.md per phase.
