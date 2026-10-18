# Diwali Express Pickup

Shop finder, green-cracker price lists and a drive-through pickup queue for licensed cracker
shops in Hyderabad. Customers plan a list on their phone, book a 30-minute pickup slot and get a
QR ticket. A marshal checks them into a holding bay; the shop counter scans the list QR and bills
it in seconds. **All buying, packing, billing and payment happen at the licensed counter** — the
platform never takes orders or money (Supreme Court orders, see [docs/SPEC.md](docs/SPEC.md) §1).

## What's inside

| Area                     | Who                    | What they can do                                                                                                        |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Shops** (`/`)          | Everyone               | Find licensed shops by area or location (map + list), see licence and next free slot                                    |
| Shop page `/s/:code`     | Everyone               | Green-cracker price list by category, search, plan list (kept only on the phone), walk-in list QR                       |
| Book `/s/:code/book`     | Customer               | Date tabs, 30-min slots with places left, vehicle; one active slot per number                                           |
| **My ticket** `/ticket`  | Customer               | QR ticket (visit code + list), bay instructions, directions, safety notice, cancel; works offline                       |
| **Shop counter** `/shop` | Vendor (owner / staff) | Today's queue (live), scan list QR → pick list by rack → bill → print (58 mm) → mark served, no-show                    |
|                          | Owner only             | Price list editor (green cert required, banned categories blocked), hours & capacity per day, licence upload, footfall  |
| **Gate** `/gate`         | Marshal                | Scan ticket → valid / reason, auto-assign holding bay, bay map, today's tickets                                         |
| **Admin** `/admin`       | Admin                  | Overview metrics, licence approval (private photo), shops (live switch), grounds, categories (ban), team roles, unblock |

Background jobs: no-show sweeper (5 min), licence expiry (hourly), daily stats, slot generator,
purge (daily OTP clean-up; full purge 90 days after the season).

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

**Demo mode** is on locally (`DEMO_MODE=true`): use **“Choose a role”** in the header to view the
app as a customer, shop owner, counter staff, gate marshal or admin — no SMS needed. With demo
mode off, sign-in is phone + OTP (`123456` while `OTP_DEV_MODE=true`).

| Seeded account | Phone           | Notes                        |
| -------------- | --------------- | ---------------------------- |
| Admin          | +91 90000 00001 |                              |
| Shop owner     | +91 90000 00011 | Sri Lakshmi Crackers (SLC01) |
| Counter staff  | +91 90000 00012 | SLC01                        |
| Gate marshal   | +91 90000 00051 | Gachibowli Stadium Ground    |
| Customer       | +91 90000 00099 | Clean account for booking    |

Shop `SAI01` starts with a pending licence: approve it in **Admin → Licences** and it appears on
the Shops page.

## Checks

```bash
pnpm check        # typecheck + lint + copy-lint (banned words) + unit tests
pnpm test:int     # API integration tests on a real Postgres (embedded locally)
pnpm build
```

## Deploy

Azure (Front Door + static website + Functions + Postgres + Key Vault), GitHub Actions with OIDC.
See [docs/DEPLOY.md](docs/DEPLOY.md). Full technical guide, pilot plan and scale-up roadmap: [docs/TECH_GUIDE.md](docs/TECH_GUIDE.md).
