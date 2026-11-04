# Xpress Pickup — overview

**Skip waiting in queue.** Customers order from shops near them in Hyderabad, the shop packs
the order, and the customer collects it at the shop's **Express Pickup** counter and pays the
shop there. Powered by Better Analytics Pvt Ltd.

The platform never handles the goods or the sale money. It earns two flat fees: **₹30 per
order** from the customer and a **₹2,499 season subscription** from each shop, both including
GST, each with a GST tax invoice.

## Who uses it

| Person                   | What they do                                                                                                               | Where                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Customer                 | Finds shops (Standard-only switch, map, areas), orders, answers out-of-stock questions, shows the pickup QR, pays the shop | Customer app (`/`)            |
| Shop owner               | Products and prices, hours, entrance photo, licence and documents, payments setup, reports, invoices, staff                | Merchant app (`/shop`)        |
| Shop staff               | Confirms orders, calls customers, works the counter                                                                        | Merchant app                  |
| Packer                   | Scans every item into the pack, prints the pack sticker, photographs the pack                                              | Merchant app → Packing        |
| Cashier                  | Scans the pickup QR, takes UPI, card or cash, prints the bill                                                              | Merchant app → Express Pickup |
| Gate marshal             | At a market ground's entrance, scans a customer's QR and points them to the right shop's counter                           | `/gate`                       |
| Agent (gig worker)       | Signs local shops up with the owner's consent; paid ₹1,000 for each shop that goes live                                    | `/agent`                      |
| Admin (Better Analytics) | Approves agents and licences, shops, categories, payouts, subscriptions, orders                                            | `/admin`                      |

Anyone can be a customer and an agent with the same phone number. Customers and visitors see a
short "How it works" the first time they open the app; shop staff see one for shops.

## How an order works

1. **Order.** The customer picks items from one shop and pays the ₹30 platform fee online. The
   order is placed only once the fee is paid (unpaid orders are cancelled after 60 minutes).
2. **Shop confirms** within 3 days, or the fee is refunded automatically.
3. **Packed.** A packer scans every item. If something is out of stock, the customer chooses an
   alternative or removes it (they get an SMS and, with notifications on, a push message).
4. **Express Pickup.** Only once the order is packed does the customer get a pickup QR. They
   show it at the counter, collect the pack and pay the shop by UPI, card or cash.

Orders go `fee_pending → placed → confirmed → packing → (awaiting_customer) → packed →
completed`, or end as `cancelled`, `rejected` or `expired`. The server enforces every step.

**When online ordering is off** (rule L1, until a legal opinion clears it), customers still
browse shops and build a **walk-in list**, then show its QR at the counter so the shop bills it
quickly. Everything else works the same.

## How a shop joins

1. An approved **agent** visits the shop and creates a draft. The owner consents by reading out
   an SMS code or tapping an Approve link.
2. The agent adds products (two photos each), the licence, hours, map pin and entrance photo.
3. The owner gets a **review link**: they see the shop as customers will, approve and pay the
   ₹2,499 subscription online or by bank transfer, or ask for changes.
4. Once paid, with the licence verified by an admin, the shop **goes live** and the agent's
   ₹1,000 payout is created. Owners can also be set up directly by an admin.

## Money

| Charge                | Amount                                            | Paid to                              | Invoice                                                              |
| --------------------- | ------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| Order platform fee    | ₹30 incl. GST (₹25.42 + ₹2.29 CGST + ₹2.29 SGST)  | Platform (Razorpay)                  | `XPF/<FY>/<n>`, SAC 996211                                           |
| Merchant subscription | ₹2,499 per season incl. GST (₹2,117.80 + ₹381.20) | Platform (Razorpay or bank transfer) | `XPS/<FY>/<n>`, SAC 996211                                           |
| The goods             | the shop's price                                  | **The shop**, at its counter         | the shop's bill                                                      |
| Agent payout          | ₹1,000 per shop that goes live                    | Agent's own UPI ID                   | admin records the UTR; TDS 2% above ₹20,000 a year, PAN from ₹18,000 |

No commission and no cut of sales (G4). No wallets, credits or referral rewards (G12, G13).

## Privacy

- A customer is a phone number plus an optional name, kept with consent and deleted 90 days
  after the season or on request ("Delete my data").
- The shop a customer orders from sees their full number and can call them from the order
  (each call is logged); gate marshals and the admin console see it masked.
- Agents never see customer data. Their UPI ID and PAN are encrypted.
- Push notifications carry no personal data.

## The apps

- **Two installable apps** from one web app: **Xpress Pickup** (customers) and **Xpress Pickup
  Merchant** (shops, gate, admin), each with its own icon and name on the home screen. They work
  offline for price lists and orders.
- **Languages:** English, Telugu and Hindi throughout.
- **Design:** Better Analytics design system (brand blue, Plus Jakarta Sans) on a Zepto-style
  layout, frosted-glass header and tab bar, and Bea, the mascot. The floating Bea icon opens the
  BEA game.
- **Notifications:** web push for new orders (shop) and each order step (customer).
- **Invoices:** customers open the fee invoice from the order; owners have an Invoices tab.

## How it is built

| Folder                      | What it is                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `xpress-pickup-backend`     | API on Azure Functions (Node 20, TypeScript), PostgreSQL 16 with Drizzle, Azure Bicep, timers |
| `xpress-pickup-frontend`    | React 18 + Vite + Tailwind PWA, TanStack Query, i18next, a custom service worker              |
| `packages/shared` (in both) | Types, validation (zod) and rules shared by both: order state machine, prices, QR codes, GST  |

On Azure: Front Door in front of a Blob Storage static website (the web app) and Azure
Functions (the API, under `/api`), with PostgreSQL, Blob Storage (photos and documents), Key
Vault (secrets) and Application Insights. Payments go through Razorpay (REST, no SDK); sign-in
codes and order SMS through MSG91. See [DEPLOYMENT.md](DEPLOYMENT.md).

**Rules the code keeps** are listed as guardrails (L1, G3–G13) at the top of each folder's
`CLAUDE.md`. The main ones: the server prices everything and never trusts the phone; only
licensed, listed shops take orders; the pickup QR and bill always carry the safety notice;
banned categories can't be listed.

## Running and checking it

Each folder's README explains running it locally, and [DEPLOYMENT.md](DEPLOYMENT.md) ends with
a quick start. Locally, demo mode lets you try every role without SMS (code `123456`).

```bash
pnpm check        # in each folder: typecheck, lint, formatting, tests (frontend also copy and i18n lint)
pnpm test:int     # backend: API tests against a real PostgreSQL
```

At the time of writing: backend 158 unit and 125 integration tests, frontend 207 tests.

## Not done yet

- **Online ordering** stays off in production until the written legal opinion (L1).
- **GST:** set the platform GSTIN and address; have the CA confirm SAC 996211; credit notes
  for refunded fees are not generated yet.
- **CI/CD:** split this repository into two (see [DEPLOYMENT.md](DEPLOYMENT.md), step 1) so the
  workflows run.
- **Push notifications** need VAPID keys in production.
- Telugu and Hindi text should be reviewed by native speakers.
