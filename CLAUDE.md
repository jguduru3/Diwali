# CLAUDE.md — Diwali Express Pickup

Product renamed from "Festive Diwali" (originally "Pataka Pickup") to **Diwali Express Pickup** (user-facing). Internal package names (`@pataka/shared`) and the list QR prefix `PP1` are unchanged.

Full spec: docs/SPEC.md, as amended by **docs/SPEC_V3_ORDERS.md** (v3 wins where they differ). Read both before any task. Work only on the phase I name.

## Non-negotiable guardrails (see SPEC §1 and SPEC_V3 §2)

- L1: Online ordering is behind ORDERING_ENABLED (off in prod) until a written legal opinion clears it. Plan-list mode must keep working when it is off.
- G3: The platform collects only its flat ₹30 fee through the payment adapter (apps/api/src/lib/payments). Sale payments go directly to the merchant at the counter (merchant's YouPI-PG UPI, card machine, cash). No payment SDKs in package.json.
- G4: No commission or per-sale platform fee.
- G5: Banned words in UI copy: buy now, delivery, deliver, delivered, 100% legal, booking confirmed.
- G6: Public shop queries go through the `visible_shops` view only; only listed shops accept orders.
- G7: Banned categories cannot be created or ordered; every item needs green_cert + green_ref.
- G8: The pickup QR screen and the bill always show the safety notice.
- G9: Phone number is the only customer personal data; staff see it masked; consent + purge + delete-me.
- G11: The server prices orders, enforces every state change and never trusts client prices, totals, status or payment flags. QR payloads are opaque random tokens stored as hashes.

If a request would break a guardrail, stop and tell me instead of implementing it.

## Stack

pnpm monorepo · TypeScript strict · Vite/React/Tailwind/TanStack Query/i18next PWA · Azure Functions v4 (Node 20) · PostgreSQL 16 + Drizzle · zod in packages/shared · Vitest, Testcontainers, Playwright · Bicep · GitHub Actions OIDC.

## Commands

- pnpm dev · pnpm test · pnpm test:int · pnpm e2e · pnpm lint · pnpm typecheck
- pnpm db:migrate · pnpm db:seed · pnpm copy-lint · pnpm check · pnpm db:embedded (Postgres without Docker)
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
