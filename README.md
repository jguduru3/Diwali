# Diwali Express Pickup

A pickup-order platform for **many licensed Diwali merchants** in Hyderabad. Customers order from
a merchant's catalogue and pay a **₹30 platform fee** online. The merchant confirms within
3 days (or the fee is refunded automatically), a packer scans and packs the order, and the
customer collects it at the shop's **Express Pickup** counter and pays the **merchant** there by
UPI (merchant's own YouPI-PG), card or cash. Spec: [docs/SPEC_V3_ORDERS.md](docs/SPEC_V3_ORDERS.md)
(amends [docs/SPEC.md](docs/SPEC.md)).

> **Legal gate (L1):** online ordering is behind `ORDERING_ENABLED`, off in production until a
> written legal opinion clears online orders for licensed firecracker retail in Telangana. With it
> off, customers can still build a list and show its QR at the counter.

## What's inside

| Area                           | Who                   | What they can do                                                                                                            |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Shops** (`/`)                | Everyone              | Find licensed shops by area or location (map + list), licence badge                                                         |
| Shop page `/s/:code`           | Everyone              | Products with photos, offer prices, low-stock badges, search, categories                                                    |
| Review `/s/:code/plan`         | Customer              | Place the order (server prices it) and pay the ₹30 fee; or show a walk-in list QR                                           |
| **My orders** `/orders`        | Customer              | Status, answer out-of-stock / alternative questions, pickup QR (works offline), bill, cancel                                |
| **Merchant** `/shop`           | Owner, staff          | Orders board: confirm or decline within 3 days                                                                              |
| Packing `/shop/packing`        | Owner, staff, packer  | Scan each unit's barcode (camera or handheld scanner), out of stock, offer alternative, finish → pack number + sticker QR   |
| Express Pickup `/shop/counter` | Owner, staff, cashier | Customer QR → pack sticker must match → UPI (YouPI-PG) / card / cash → bill → next; walk-in list QRs too                    |
| Products, hours, payments      | Owner                 | Photos, barcode, price, offer price + end, stock, sold-out; opening hours; YouPI-PG / card / cash settings; licence; report |
| **Gate** `/gate`               | Marshal               | Scan a pickup QR → which shop and pack number                                                                               |
| **Admin** `/admin`             | Platform team         | Orders, fees and refunds, merchant onboarding (shops, licences, payment settings, team roles), categories, blocked numbers  |

Background jobs: order expiry with automatic ₹30 refund (hourly), licence expiry (hourly), daily
stats, push retries (every minute), purge (daily OTP clean-up; customers anonymised 90 days after
the season, financial records kept).

**Two installable apps** (Android and iPhone, from the browser): **Diwali Express** for customers
and **Diwali Express Merchant** (`/merchant`) for shop staff, marshals and admins. Both work
offline for price lists and orders, and send web push notifications for order updates once turned
on in My account. See [Overview.md §10.1](Overview.md).

To try the built PWA locally (service worker, install, update): `pnpm --filter web build` then
`pnpm --filter web preview --port 4173` with `pnpm dev` running for the API.

## Run it locally

Needs Node 20+ and pnpm 9 (`npm i -g pnpm@9`), Azure Functions Core Tools 4
(`npm i -g azure-functions-core-tools@4`). Docker is optional.

```bash
pnpm install
cp apps/api/local.settings.example.json apps/api/local.settings.json
pnpm db:embedded        # Postgres 16 without Docker (or: docker compose up -d) — leave it running
pnpm db:migrate && pnpm db:seed
pnpm dev                # web http://localhost:5173 · API :7071 · storage emulator :10000
```

**Demo mode** is on locally (`DEMO_MODE=true`): use **“Choose a role”** in the header. The ₹30 fee
uses the **mock payment provider** (test page, no real money), and shops without YouPI-PG settings
get a **simulated counter UPI**. Both are refused when `APP_ENV=prod`.

| Seeded account | Phone                | Notes                                                |
| -------------- | -------------------- | ---------------------------------------------------- |
| Admin          | +91 90000 00001      |                                                      |
| Shop owner     | +91 90000 00011      | Sri Lakshmi Crackers (SLC01)                         |
| Shop staff     | +91 90000 00012      | SLC01: confirms orders                               |
| Packer         | +91 90000 00013      | SLC01: barcodes are `891` + item no., e.g. `8910001` |
| Cashier        | +91 90000 00014      | SLC01: Express Pickup                                |
| Gate marshal   | +91 90000 00051      | Gachibowli Stadium Ground                            |
| Customer       | +91 90000 00099      | Clean account                                        |
| Customers      | +91 90000 00091 / 92 | An order waiting for the shop / a packed order       |

`pnpm db:seed` prints the packed demo order's pickup and pack-sticker QR texts, which can be typed
at the counter. Shop `SAI01` starts with a pending licence: approve it in **Admin → Licences**.

## Checks

```bash
pnpm check        # typecheck + lint + copy-lint (banned words) + unit tests
pnpm test:int     # API integration tests on a real Postgres (embedded locally)
pnpm build
```

## Deploy

Azure (Front Door + static website + Functions + Postgres + Key Vault), GitHub Actions with OIDC.
See [docs/DEPLOY.md](docs/DEPLOY.md). Before switching ordering on in prod, work through
[docs/SPEC_V3_ORDERS.md](docs/SPEC_V3_ORDERS.md) §10.
