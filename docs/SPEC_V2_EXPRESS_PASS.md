# Diwali Express Pickup — SPEC v2: Express Pass

**Version:** 2.0 · 18 Oct 2026 · Amends `docs/SPEC.md`. Where they differ, this file wins.

## 1. What changed and why

- **Renamed** to _Diwali Express Pickup_.
- **Slot booking removed.** Fixed 30-minute slots do not work with Hyderabad traffic. Slots, visits, holding bays, no-show strikes and the slot generator are gone.
- **Express Pass added.** A customer pays a flat **₹30** platform verification fee once and gets one universal pass (QR + reference). Any participating, licensed shop — and the marshal at a shop ground — can scan it to verify the customer during its validity period.
- **Unchanged:** shop finder, green price lists, plan list on the phone, list QR scanned at the counter, pay at the shop, licences, admin, G1/G2/G5–G9.

The pass verifies the customer. It does **not** reserve crackers, guarantee stock or confirm a purchase (G10). Cracker prices are final and paid at the shop.

The ₹30 is the platform's own service fee, not money collected for shops, so no funds are held for merchants (see `docs/MARKETPLACE_PHASE0_AUDIT.md` §5).

## 2. Guardrail changes

| #   | Before                                   | Now                                                                                                                   |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| G3  | No online payment at all                 | Only the flat pass fee, via the provider adapter. Still no SDKs in package.json and no `upi://` in our code           |
| G4  | No money on visits                       | No sale amounts anywhere; pass fee is flat; no money on scans or shops                                                |
| G8  | Safety notice on the ticket              | Safety notice on the pass and on the list QR screen                                                                   |
| G10 | —                                        | Pass verifies identity only; pass screen states it holds no stock and confirms no purchase                            |

## 3. Decisions (defaults, all configurable)

| Decision            | Default                                                                       | Setting             |
| ------------------- | ----------------------------------------------------------------------------- | ------------------- |
| Validity            | From payment until the end of the season (`SEASON_END`, 23:59 IST)            | `PASS_VALID_HOURS` (set to use a rolling window instead) |
| Where usable        | Any participating shop and shop grounds, any number of visits                 | —                   |
| Reuse               | Every scan recorded; suspicious patterns flagged, never auto-blocked          | `lib/passes.ts` thresholds |
| Delivery            | QR + reference on the website (works offline once shown)                      | SMS/WhatsApp later (DLT templates) |
| Fee recipient       | Platform keeps the full ₹30 (sharing with shops needs legal review)           | —                   |
| One pass per number | One pending or active pass per customer per season                            | DB partial unique index |
| Payments            | Mock provider in dev/demo; paid passes off in prod                            | `PAYMENT_PROVIDER`, `PASSES_ENABLED` |

## 4. Pass lifecycle

`pending_payment → active → (expired | revoked | refund_pending → refunded)`

- `active` only after a **signature-verified** `payment.captured` event; redirects and client flags change nothing.
- Expiry is computed from `valid_to`; no job is needed.
- Revocation (admin) stops verification at once; refund (admin) sets `refund_pending`, then `refunded` on the provider's `refund.processed` event.

### QR and secret

- QR text: `DXP1.<26-char Crockford base32>` (128 random bits). Only QR-alphanumeric characters, so it scans fast at night.
- The server stores **only a SHA-256 hash** of the secret. The secret is shown once to the customer's phone and cached there.
- "Show my pass on this phone" **rotates** the secret: the old QR stops working (lost phone, screenshot shared).
- The QR carries no phone number, name, prices or items.

### Verification (shop counter or ground marshal)

`POST /api/shop/passes/verify {qr}` / `POST /api/gate/passes/verify {qr}` → result + record in `pass_scans`.

Results: `valid`, `not_found` (unknown or replaced QR), `not_paid`, `expired`, `revoked`, `refunded`. Valid scans can carry a **flag** (still valid):

- seen at ≥ 4 different places within 60 minutes;
- ≥ 3 scans at the same place within 10 minutes;
- ≥ 20 scans in one IST day.

The scanner sees: result, pass reference, valid-until, masked phone (`••••••1234`), scans today, flag reason.

## 5. Payments

Adapter interface (`apps/api/src/lib/payments`): `createCheckout`, `verifyWebhook`, `refund`.

- **Mock provider** (`PAYMENT_PROVIDER=mock`, refused when `APP_ENV=prod`): test checkout page `/pay/mock/:checkoutId` with _Pay ₹30_ / _Fail_; events are HMAC-SHA256 signed with `MOCK_PAYMENT_SECRET` and go through the same webhook processor as a real provider.
- **Webhook** `POST /api/payments/webhook/{provider}`: raw-body signature check, no CSRF header (server-to-server), idempotent on `(provider, event_id)`; amount must equal the pass fee.
- A real provider (an RBI-authorised aggregator) is added as another adapter — REST over `fetch`, no SDK — after compliance sign-off.

## 6. Data (migration 0004)

Dropped: `slots`, `visits`, `visit_status`, `daily_shop_stats` (old shape), `users.no_show_strikes`, `clusters.bay_count`, `shops.slot_minutes`, `shops.default_capacity_per_slot`.

Added:

- `passes` (user, status, ref, secret_hash, fee_paise, valid_from, valid_to, revoked/refund fields)
- `payments` (pass, provider, checkout_id, provider_payment_id, status, amount_paise, idempotency_key)
- `payment_events` (provider, event_id unique, type, payload digest, processed_at)
- `refunds` (payment, amount_paise, status, provider_refund_id, reason, actor)
- `pass_scans` (pass nullable, shop or cluster, scanned_by, result, flag_reason, at) — no money columns
- `daily_shop_stats` (shop, day, scans, unique_passes, flagged)

## 7. API

Customer: `GET /api/passes/current`, `POST /api/passes` (start or resume payment), `POST /api/passes/current/qr` (rotate + reveal secret).
Payments: `POST /api/payments/webhook/{provider}`, `GET /api/payments/mock/{checkoutId}`, `POST /api/payments/mock/{checkoutId}/complete` (mock only).
Shop: `POST /api/shop/passes/verify`, `GET /api/shop/passes/scans?date=`, `PUT /api/shop/settings` (hours only), `GET /api/shop/stats`.
Gate: `POST /api/gate/passes/verify`, `GET /api/gate/today`.
Admin: `GET /api/console/passes?q=&status=`, `POST /api/console/passes/{id}/revoke`, `POST /api/console/passes/{id}/refund`, `GET /api/console/scans/flagged`, `GET /api/console/metrics` (passes issued, fees, refunds, scans, participating shops).

Removed: `/api/visits*`, `/api/shops/{code}/slots`, `/api/shop/slots*`, `/api/shop/visits*`, `/api/gate/checkin`.

## 8. Retention (G9)

- Daily: OTP and rate-limit rows older than a day.
- From `SEASON_END + 90 days`: delete `pass_scans`, anonymise customers, withdraw consents.
- `passes`, `payments`, `refunds` and `payment_events` are financial records and are **kept** (linked only to the anonymised user id). Confirm the retention period with the CA.

## 9. Compliance gate

Before `PASSES_ENABLED=true` in prod: written review of the multi-retailer workflow, fee and customer wording for Telangana; an RBI-authorised provider adapter; GST treatment of the ₹30. A verification-only design does not by itself make charging for it lawful in the context of regulated firecracker sales.
