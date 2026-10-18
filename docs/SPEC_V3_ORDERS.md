# Diwali Express Pickup — SPEC v3: multi-merchant pickup orders

**Version:** 3.0 · 18 Oct 2026 · Amends `docs/SPEC.md`. Where they differ, this file wins. (v2 "Express Pass" was superseded before release.)

## 1. Product

A platform for **many Diwali merchants** in Hyderabad, onboarded by the platform team. Customers order from a merchant's catalogue online and **collect and pay at the merchant's Express Pickup counter**.

1. **Merchant** (onboarded by admin after licence verification) manages products: photos, barcode, price, offer price (discount), stock, sold-out.
2. **Customer** picks a locality → merchant → products → places an order and pays a **₹30 platform fee** online.
3. **Merchant confirms** the order within **3 days**, or the ₹30 is refunded automatically.
4. **Packer** opens a confirmed order, scans each item's barcode, marks items **out of stock** or **proposes an alternative**; the customer must accept or decline each change (silence is never approval). Packer packs and finishes.
5. On packing, two QRs are issued: a **pack sticker QR** (printed, stuck on the pack, with the pack number) and the **customer pickup QR** (on the customer's phone).
6. **Cashier** at Express Pickup scans the customer QR → the order opens with its pack number → scans the pack sticker (must match) → takes payment **to the merchant** by **UPI (merchant's own YouPI-PG)**, **card machine** or **cash** → the bill goes to the customer → order closed → next.

The platform never holds the merchant's sale money. The only money the platform collects is its own ₹30 fee.

## 2. Guardrails (replace SPEC §1 where listed)

| #   | Rule                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **Legal gate.** Online ordering is behind `ORDERING_ENABLED` (off by default and in prod Bicep) until a written legal opinion clears online orders for licensed firecracker retail in Telangana. The plan-list mode keeps working when it is off. |
| G3  | Platform collects only the flat ₹30 fee through its payment adapter (mock in dev). Sale payments go **directly to the merchant** at the counter (merchant's YouPI-PG UPI, card machine, cash). No payment SDKs in package.json. |
| G4  | No commission or per-sale platform fee. Order totals are the merchant's bill and are stored for the bill and reconciliation only.                                                                                          |
| G5  | Banned UI words now: buy now, delivery, deliver, delivered, 100% legal, booking confirmed. (Order/cart wording is allowed; pickup only, pay at the counter.)                                                                |
| G6  | Public shop queries use `visible_shops` only; only listed shops accept orders.                                                                                                                                              |
| G7  | Banned categories cannot be created or ordered; every item has green_cert + green_ref.                                                                                                                                      |
| G8  | Safety notice on the pickup QR screen and on the bill.                                                                                                                                                                      |
| G9  | Phone is the only customer personal data; staff see a masked number; consent, purge, delete-me.                                                                                                                             |
| G11 | Server is the source of truth: it prices orders from the catalogue, enforces every state change, and never trusts client prices, totals, status or payment flags. QR payloads are opaque random tokens stored as hashes. |

## 3. Roles

`customer` · `shop_owner` (merchant: everything for their shop) · `shop_staff` (accept orders, counter) · `shop_packer` (packing only) · `shop_cashier` (Express Pickup counter only) · `marshal` (ground gate: look up a pickup QR to direct the customer) · `admin` (platform team: onboarding, licences, refunds, reports).

## 4. Platform fee (₹30)

| Event                                           | Fee                         |
| ----------------------------------------------- | --------------------------- |
| Order placed                                    | Customer pays ₹30 (adapter) |
| Merchant confirms within 3 days                 | Fee earned                  |
| Not confirmed within 3 days (job, hourly)       | Full ₹30 refund             |
| Merchant rejects, or customer cancels before confirmation | Full ₹30 refund   |
| Customer cancels after confirmation / never collects | Fee kept                |

`fee_pending` orders are not visible to merchants. Payment state changes only from signature-verified provider events (idempotent per event id).

## 5. Order states

```
fee_pending → placed → confirmed → packing ⇄ awaiting_customer → packed → completed
                │          │          │              │               │
                └──────────┴──────────┴──────────────┴───────────────┴→ cancelled / rejected / expired
```

- `placed`: fee paid, waiting for the merchant (deadline `confirm_by = fee_paid_at + 3 days`).
- `awaiting_customer`: at least one line has an out-of-stock or alternative decision pending.
- `packed`: all lines resolved, at least one item picked, QRs issued, pack number assigned.
- `completed`: cashier matched pack + customer QR and recorded payment; bill issued.

Line states: `pending → picked` · `pending → out_of_stock` (customer: remove / cancel order) · `pending → alternate_proposed` (customer: accept → new line for the alternative, old line `replaced`; decline → `removed`).

Pricing: unit price = the item's offer price if set and not ended, else price; snapshotted on the order line when ordered. Alternatives use the alternative's current effective price. Final total = Σ picked lines.

## 6. QR codes

- Customer pickup QR: `DXO1.<26 Crockford chars>`; pack sticker QR: `DXK1.<26 chars>`. 130 random bits each, SHA-256 hash stored, single order, no personal data, prices or items.
- The cashier must scan both; a pack from a different order is refused.
- The plan-list QR (`PP1…`) for walk-in counters is unchanged.

## 7. Counter payments (to the merchant)

- **UPI via YouPI-PG**: each merchant's own YouPI-PG instance (base URL, merchant id, webhook secret — set by the platform team). The cashier screen creates a YouPI payment (`POST /api/v1/payments`, `Idempotency-Key`) and shows its checkout link as a QR; confirmation by signed webhook (`X-Gateway-Signature: sha256=<HMAC of raw body>`) or by the server polling `GET /api/v1/payments/{id}`. The amount must match the bill.
- **Card machine**: cashier records the terminal approval code after the POS approves.
- **Cash**: cashier records the amount received; change is shown.
- YouPI-PG risks (own README): payment confirmation by reading bank SMS/email, commercial licence — each merchant accepts these when choosing it.

## 8. Bill

Issued on payment: per-shop bill number, merchant name and licence no., lines, total, payment method/reference, safety notice. Customer sees it in **My orders** (SMS/WhatsApp copy later, after DLT templates).

## 9. Data (migrations 0004–0005)

Removed: slots, visits, visit_status, old daily stats, no-show strikes, bay count, slot settings.
Added: item `barcode`, `stock_qty`, `offer_price_paise`, `offer_ends_at`, `image_path`; roles `shop_packer`, `shop_cashier`; `orders`, `order_lines`, `order_events`, `fee_payments`, `fee_payment_events`, `fee_refunds`, `counter_payments`, `merchant_payment_settings`, `daily_shop_stats` (orders, completed, sales_paise for the merchant's own report).

## 10. Compliance gate

Before `ORDERING_ENABLED=true` in prod: legal opinion on online orders for licensed firecracker retail (SC orders, Explosives Rules, Telangana police licence conditions); an RBI-authorised provider for the ₹30 with refunds; GST on the fee; merchant acceptance of YouPI-PG terms.
