# Marketplace token model — design (draft, not built)

**Status:** design only, 18 Oct 2026. Nothing here is implemented. Applies **only to an approved non-firecracker category**, behind `MARKETPLACE_ENABLED=false` by default. Firecracker shops keep today's pay-at-counter flow and guardrails G1–G9 (see `docs/MARKETPLACE_PHASE0_AUDIT.md`).

## 1. The model (owner's definition)

The customer pays a fixed **₹100 token** online when they place the order. The token splits into:

| Part                     | Amount | Who gets it | When                                        |
| ------------------------ | ------ | ----------- | ------------------------------------------- |
| Platform handling charge | ₹30    | Platform    | Only after verified pickup                  |
| Purchase credit          | ₹70    | Merchant    | Deducted from the final bill at the counter |

### Worked example — basket ₹1,000

| Step                                       | Customer             | Merchant               | Platform            |
| ------------------------------------------ | -------------------- | ---------------------- | ------------------- |
| Places order, pays token                   | −₹100                | —                      | — (held, see §2)    |
| Counter scans pickup QR, final bill ₹1,000 | pays ₹930 at counter | +₹930 at counter       | —                   |
| Collection confirmed                       | —                    | +₹70 credit released   | +₹30 fee recognised |
| **Total**                                  | **₹1,030**           | **₹1,000** (full bill) | **₹30**             |

The customer pays the bill plus the ₹30 handling charge. That must be shown before payment: _"Token ₹100 = ₹70 off your bill + ₹30 handling charge"_.

## 2. Where the ₹100 sits until pickup

This is the one decision that determines whether the model is legal.

- **Not allowed:** collecting the ₹100 into the platform's own bank account (for example with YouPI-PG's direct UPI flow) and later paying ₹70 to the merchant. That is collecting money on behalf of merchants, which in India needs RBI authorisation as a payment aggregator (Payment and Settlement Systems Act 2007; RBI PA Directions 2025).
- **Allowed:** collect through an **RBI-authorised payment aggregator that supports split payments with hold and reversal** (e.g. Razorpay Route, Cashfree Easy Split, PayU split settlements). The ₹100 sits in the **aggregator's escrow**, not the platform's account. On pickup, the platform tells the aggregator to release ₹70 to the merchant's linked account and ₹30 to the platform. On failure it refunds ₹100 and reverses the split.

**Merchants do not need their own gateway.** Under split/route products the platform holds the gateway account; each merchant is onboarded as a _linked account_ with bank details and KYC only. Bank and UPI charges are the aggregator's usual MDR on the ₹100 (UPI P2M is typically zero MDR for small merchants; cards are not — confirm with the provider).

## 3. Rules the server enforces

| #   | Rule                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | Token amount and split are server constants (`TOKEN_PAISE=10000`, `FEE_PAISE=3000`, `CREDIT_PAISE=7000`), never taken from the client.                                                                       |
| T2  | An order is `token_paid` **only** after a signature-verified aggregator webhook. A redirect or "success" screen changes nothing.                                                                             |
| T3  | Webhooks are idempotent: unique `(provider, provider_event_id)`; replays are ignored.                                                                                                                        |
| T4  | The pickup QR is issued only when the order is packed: random 128-bit opaque token, stored as a hash, bound to order + shop, expires, single use. It carries no prices, items or phone number.               |
| T5  | Counter scan returns: token status, credit available, final bill, **amount to collect = bill − credit**.                                                                                                     |
| T6  | "Mark collected" runs in one transaction: consume QR, set `collected`, write ledger rows, enqueue the release with an idempotency key. The fee is recognised **exactly once** (unique ledger row per order). |
| T7  | Credit never exceeds the bill. If the final bill is below ₹70, credit = bill and the difference is refunded to the customer.                                                                                 |
| T8  | Merchant cannot fulfil, or eligible non-collection → **full ₹100 refund**; no fee kept.                                                                                                                      |
| T9  | Every transition records actor, time and reason in `order_events` and `audit_log`.                                                                                                                           |

## 4. Order states (token part)

`created → token_pending → token_paid → validating → awaiting_customer (substitutions) → confirmed → packing → ready (QR issued) → collected`

Side exits: `token_failed`, `cancelled_by_customer`, `merchant_unfulfilled → refund_pending → refunded`, `expired → exception_queue` (packed stock is **not** auto-returned to inventory), `refund_failed → admin queue`.

## 5. Ledger per order (paise)

| Event                                 | Entry                      | Amount           |
| ------------------------------------- | -------------------------- | ---------------- |
| Webhook: payment captured             | `token_held`               | +10000           |
| Collected                             | `merchant_credit_released` | −min(7000, bill) |
| Collected                             | `platform_fee_recognised`  | −3000            |
| Collected, bill < ₹70                 | `excess_credit_refunded`   | −(7000 − bill)   |
| Unfulfilled / eligible non-collection | `token_refunded`           | −10000           |

Every order's ledger sums to zero once it is closed. The reconciliation report compares these rows with the aggregator's settlement and refund reports.

## 6. Data (additive migration, marketplace module only)

`orders` (status, shop, customer, token/credit/fee paise, final_bill_paise), `order_lines`, `order_line_changes`, `order_events`, `payments` (provider refs, state), `refunds`, `pickup_tokens` (hash, expires_at, consumed_at), `platform_ledger` (unique `(order_id, kind)` for fee/credit), `merchant_payout_accounts` (aggregator linked-account id only — no bank numbers stored), `shops.vertical`. Visits, slots and the firecracker plan-list QR are untouched.

## 7. API (marketplace only, 404 when the flag is off or shop vertical not approved)

`POST /api/orders` · `POST /api/orders/{id}/token-payment` (creates aggregator order) · `POST /api/payments/webhook` · `POST /api/orders/{id}/decisions` · `POST /api/shop/orders/{id}/ready` · `POST /api/shop/pickup/verify` · `POST /api/shop/orders/{id}/collect` · `POST /api/orders/{id}/refund` · `GET /api/shop/reports/reconciliation`.

## 8. Guardrail changes this needs (owner sign-off required)

- G1/G4 tests: stay global for `visits`, slots and the plan-list QR; `orders`/`order_lines` allowed **only** in the marketplace module, plus a new test that no `firecracker` shop can have an order.
- G3 test: allow exactly one named aggregator SDK, server-side only; `upi://` stays banned in our code (the aggregator's hosted checkout handles UPI).
- G5 copy-lint: separate allow-list for marketplace screens only.

## 9. Open questions

1. Which category goes first (e.g. sweets, diyas, puja items, dry fruits)?
2. Which aggregator? Needs written confirmation of: category, hold-until-pickup, split to linked accounts, full and partial refund with reversal, settlement timing.
3. Customer simply doesn't turn up (not an "eligible" case): refund ₹70 and keep ₹30, or keep ₹100?
4. Is ₹30 inclusive of GST? The platform likely has e-commerce operator obligations (GST registration, GST TCS and income-tax TDS u/s 194-O on facilitated sales) — confirm with a CA.
5. Pickup window and expiry length per category.
