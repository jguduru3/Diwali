# Growth program — what is built

Agents (gig workers) set merchants up and are paid ₹1,000 per merchant that goes live, straight
to their own UPI ID. Owner's decision of 3 November 2026: **no referral network, no influencer
program, no customer credit and no wallets** (CLAUDE.md: G12 and G13 amended, G9 narrowed). L1
is unchanged: `ORDERING_ENABLED` stays off in production until the legal opinion.

## Who does what

| Person             | Screen                                           | Can                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent              | `/agent`                                         | Register with name and the UPI ID payouts go to (pending until an admin approves); add a merchant; owner's consent (OTP or link); set the shop up in the shop screens (products, licence and documents, hours) plus GSTIN, map pin and address; submit; share the review link; feedback once live |
| Agent              | `/agent` → Your payouts                          | Each payout with its status, TDS and UTR; earned, paid and on-the-way totals for the year; change the UPI ID (failed payouts queue again); add the PAN when asked                                                                                                                                 |
| Owner (no sign-in) | `/m/approve/…`, `/m/review/…`                    | Agree to the setup; review the shop and price list; approve and pay ₹1,999 + GST online or by bank transfer; ask for changes; decline; report "I never agreed"                                                                                                                                    |
| Owner              | Shop → Shop QR                                   | Print the shop QR poster or standee                                                                                                                                                                                                                                                               |
| Admin              | Admin → Agents, Payouts, Subscriptions, Feedback | Approve or suspend agents; send each payout and record its UTR, mark a failed transfer, retry or reverse it; mark bank-transfer subscriptions paid                                                                                                                                                |

## Money rules (`packages/shared/src/growth.ts`, unit-tested)

| Rule                      | Value                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merchant subscription     | ₹1,999 + ₹360 GST = ₹2,359 per season, through the fee adapter (Razorpay) or by bank transfer; invoice `DXE/<season>/000001`                                                         |
| Agent payout              | ₹1,000 once per shop, when the subscription is paid and the licence verified (shop goes live); only with the owner's consent recorded and when the agent is not a member of the shop |
| Where it goes             | Straight to the agent's own UPI ID; an admin sends it from the payout account and records the UTR                                                                                    |
| PAN and TDS (CA-approved) | PAN asked at ₹18,000 earned in the financial year; payouts wait from ₹20,000 until it is on file; 2% TDS on the part above ₹20,000, worked out per payout and never charged twice    |
| Failed transfer           | Marked by the admin with a reason; the agent is told to check their UPI ID; a new UPI ID or an admin retry queues it again                                                           |
| Reversal                  | A refunded subscription or a failed licence reverses the payout (cancelled if unsent, recorded for recovery if sent) and suspends the agent                                          |

Payout rows are append-only and idempotent (G13): one per shop, moved only forward by
compare-and-set (`pending → sent | failed`, `failed → pending`, `→ reversed`). A sent payout
always carries its UTR and TDS never exceeds the payout (database checks).

## Kits

Five standard kit types (₹1,000, ₹2,000, family, gift, special). A kit is one product
(`items.kind = 'kit'`, `kit_type`, `contents`) with its own price and barcode, scanned once.
Home → Kits lists each type with shop counts and the lowest price; `/kits/<type>` compares shops
(nearest first once located).

## Also built

- **Reminders:** in-app notices to the agent at 24 h and 48 h while the owner has not answered the
  review link (hourly job `onboardingReminders`); the link still expires at 72 h.
- **Photo check:** on-device brightness, glare and blur check with a retake prompt for licence,
  document and product photos. It advises only; the server still checks type and size.

## Choices made where the guide could not be followed literally

| Guide                                            | Built                                                                                                           | Why                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Payout provider transfers (RazorpayX / Cashfree) | An admin sends each transfer from the payout account and records the UTR                                        | No payout account or API keys exist yet; an adapter can replace the manual step (REST, no SDK — G3) |
| ₹1 UPI name verification at agent sign-up        | Admin approval of each agent                                                                                    | Needs the payout provider                                                                           |
| WhatsApp messages to owners and agents           | Consent code by SMS (existing OTP sender); links shown to the agent to forward (WhatsApp share); in-app notices | No WhatsApp Business API account                                                                    |
| Standee / A4 PDF files                           | Print-ready page (Shop → Shop QR), "Save as PDF" from the browser                                               | No PDF library needed                                                                               |
| GSTIN mandatory on every shop                    | Mandatory for agent-onboarded shops (submit check) and on the GST certificate document                          | Existing shops have none yet                                                                        |

## Sign-off

- **CA: approved** (recorded 2026-11-03, owner's confirmation): the TDS handling (no deduction
  below ₹20,000 earned in the financial year, PAN asked at ₹18,000, 2% on the excess above
  ₹20,000) and the in-app agreements for agents and merchants.
- The L1 legal opinion on online ordering is separate and still pending: `ORDERING_ENABLED`
  stays off in production.

## Still to do before launch

- Razorpay live keys and webhook for the ₹30 fee and the subscription (adapter built; see
  docs/DEPLOY.md), and a payout account (bank or UPI) the admin sends the ₹1,000 transfers from.
- Native-speaker review of the new Telugu and Hindi strings.
