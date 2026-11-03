# Growth program — what is built

Implements the _Diwali Express — Growth Program: Final Guide_ (3 November 2026) with the guardrail
changes the owner approved on 3 November 2026 (CLAUDE.md: G3 amended, G5 extended, G7 relaxed,
G9 extended, G12 and G13 added). L1 is unchanged: with ordering off, referrals never qualify.

## Who does what

| Person             | Screen                                         | Can                                                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer           | Account → My credit (`/credit`)                | Referral code and share link, claim a code before the first order, credit balance and history, use credit on an order                                                                                                                                      |
| Agent              | `/agent`                                       | Register (pending until an admin approves), add a merchant, owner's consent (OTP or link), set the shop up in the shop screens (products, licence and documents, hours) plus GSTIN, map pin and address, submit, share the review link, feedback once live |
| Influencer         | `/influencer`                                  | Register (pending until approved), code and QR, share links for customers (`/r/DXI-…`) and agents (`/agent?recruit=DXI-…`), stats                                                                                                                          |
| Agent / influencer | `/wallet`                                      | Balance, today's remaining (₹2,000 cap), withdraw, PAN when asked, history                                                                                                                                                                                 |
| Owner (no sign-in) | `/m/approve/…`, `/m/review/…`                  | Agree to the setup; review the shop and price list; approve and pay ₹1,999 + GST online or by bank transfer; ask for changes; decline; report "I never agreed"                                                                                             |
| Owner              | Shop → Credits, Shop QR                        | Credit owed by the platform, ask for it once a day, settlement history; print the shop QR poster or standee                                                                                                                                                |
| Admin              | Admin → Agents, Payouts, Settlements, Feedback | Approve or suspend agents and influencers; record withdrawal transfers (UTR) or failures; reverse a payout; record credit settlements (UTR); mark bank-transfer subscriptions paid                                                                         |

## Money rules (all in `packages/shared/src/growth.ts`, unit-tested)

| Rule                    | Value                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merchant subscription   | ₹1,999 + ₹360 GST = ₹2,359 per season, through the fee adapter or by bank transfer; invoice `DXE/<season>/000001`                                                                           |
| Agent payout            | ₹1,000 once per shop, when the subscription is paid and the licence verified (shop goes live); only with the owner's consent recorded and when the agent is not a member of the shop        |
| Recruit reward          | ₹10 to the influencer, once, on the recruited agent's first live merchant                                                                                                                   |
| Referral reward         | ₹10 when the referred person's first order has the ₹30 fee captured and is packed (same transaction); reversed if that fee is refunded                                                      |
| Customer credit         | Spent only at a listed shop's counter, held with the balance locked when the cashier takes payment, redeemed with the bill, released if the order closes without one; expires at season end |
| Settlement to merchants | Weekly job (Monday 03:30 IST) or on request once a day; built only from redemption rows                                                                                                     |
| Withdrawals             | Any number a day up to ₹2,000; PAN asked at ₹18,000 earned in the FY, required at ₹20,000; 2% TDS on the excess above ₹20,000 only; 3 failed transfers freeze the wallet                    |

Every money row is append-only and idempotent: `wallet_ledger` and `credit_ledger` are unique on
(reason, ref_id); one payout per shop; one referrer per person; one redemption per order.

## Kits

Five standard kit types (₹1,000, ₹2,000, family, gift, special). A kit is one product
(`items.kind = 'kit'`, `kit_type`, `contents`) with its own price and barcode, scanned once.
Home → Kits lists each type with shop counts and the lowest price; `/kits/<type>` compares shops
(nearest first once located).

## Choices made where the guide could not be followed literally

| Guide                                            | Built                                                                                                                 | Why                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Payout provider transfers (RazorpayX / Cashfree) | Withdrawals are queued; an admin sends the transfer from the payout account and records the UTR (provider `manual`)   | No payout account or API keys exist yet; an adapter can replace the manual step (REST, no SDK — G3) |
| ₹1 UPI name verification at agent sign-up        | Admin approval of each agent and influencer                                                                           | Needs the payout provider                                                                           |
| WhatsApp messages to owners and agents           | Consent code by SMS (existing OTP sender); links shown to the agent to forward (WhatsApp share); in-app notifications | No WhatsApp Business API account                                                                    |
| Standee / A4 PDF files                           | Print-ready page (Shop → Shop QR), "Save as PDF" from the browser                                                     | No PDF library needed                                                                               |
| GSTIN mandatory on every shop                    | Mandatory for agent-onboarded shops (submit check) and on the GST certificate document                                | Existing shops have none yet                                                                        |

## Also built

- **Reminders:** in-app notices to the agent at 24 h and 48 h while the owner has not answered the
  review link (hourly job `onboardingReminders`); the link still expires at 72 h.
- **Influencer link visits:** counted from the `/r/` landing (`POST /api/r/{code}/visit`, once per
  link per browser per day, rate-limited per IP) and shown on the influencer page.
- **Photo check:** on-device brightness, glare and blur check with a retake prompt for licence,
  document and product photos. It advises only; the server still checks type and size.

## Sign-off

- **CA: approved** (recorded 2026-11-03, owner's confirmation): the TDS handling (no deduction
  below ₹20,000 earned in the financial year, PAN asked at ₹18,000, 2% on the excess above
  ₹20,000) and the in-app agreements for agents, influencers, merchants and referrals.
- The L1 legal opinion on online ordering is separate and still pending: `ORDERING_ENABLED`
  stays off in production, so referrals do not qualify there yet.

## Still to do before launch

- A real fee-payment provider for the ₹30 fee and the subscription (mock only today) and a payout account.
- Native-speaker review of the new Telugu and Hindi strings.
