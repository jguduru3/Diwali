# CLAUDE.md — Festive Diwali

Product renamed from "Pataka Pickup" to **Festive Diwali** (user-facing). Internal package names (`@pataka/shared`) and QR prefix `PP1` are unchanged.

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
- pnpm db:migrate · pnpm db:seed · pnpm copy-lint · pnpm check · pnpm db:embedded (Postgres without Docker)
- Demo mode (DEMO_MODE=true, never in prod): one-tap role switcher; see README.md

## Working rules

- TDD for shared logic (QR codec, slot math, booking transaction, no-show sweeper).
- Every API handler: zod `.strict()` body, role + membership check, audit_log on mutation.
- Money in integer paise; times as timestamptz, display in Asia/Kolkata.
- All UI strings in i18n/en.json and i18n/te.json — no hard-coded copy.
- Before saying a phase is done: run typecheck, lint, copy-lint, all tests, and show the output.
- Small commits with clear messages. Update CHANGELOG.md per phase.
