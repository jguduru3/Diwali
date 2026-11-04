# Xpress Pickup — backend

The API, database and Azure infrastructure for Xpress Pickup. Powered by Better Analytics Pvt Ltd.
The web app lives in the separate **xpress-pickup-frontend** repository.

| Folder            | What it is                                                                        |
| ----------------- | --------------------------------------------------------------------------------- |
| `apps/api`        | Azure Functions (Node 20, TypeScript): HTTP API, timers, migrations in `src/db`   |
| `packages/shared` | Types, validation and rules shared with the frontend (keep both copies identical) |
| `infra`           | Bicep: Functions, PostgreSQL Flexible Server, Blob Storage, Key Vault, Front Door |
| `.github`         | CI, `deploy-infra.yml` (Azure resources), `deploy-api.yml` (migrate + deploy API) |
| `docs/DEPLOY.md`  | Step-by-step Azure deployment                                                     |

## Run it locally

Needs Node 20+ and pnpm 9 (`npm i -g pnpm@9`).

```bash
pnpm install
cp apps/api/local.settings.example.json apps/api/local.settings.json
pnpm db:up            # Postgres 16 in Docker (or: pnpm db:embedded, no Docker)
pnpm db:migrate && pnpm db:seed
pnpm dev              # Azure Functions Core Tools on :7071 (plus Azurite for Blob Storage)
# No Core Tools? pnpm dev:host serves the same HTTP API on :7071 (timers don't run).
```

The frontend's dev server forwards `/api` to `http://localhost:7071` (change it there with
`API_PROXY_TARGET`). Demo mode signs in without SMS; the test code is `123456`.

## Checks

```bash
pnpm check            # typecheck, lint, formatting, unit tests
pnpm test:int         # API integration tests against Postgres (TEST_DATABASE_URL, or embedded Postgres)
pnpm build            # bundles apps/api/dist for deployment
```

## Settings

Every value comes from settings, never from code. Locally they live in
`apps/api/local.settings.json`; in Azure, `infra/main.bicep` sets them on the Function App
(secrets as Key Vault references).

| Setting                                                                | What it does                                                                                      | Default / note                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `APP_ENV`                                                              | `dev` or `prod`; prod turns on every production check                                             | —                                                           |
| `DATABASE_URL`                                                         | PostgreSQL connection (app role)                                                                  | Key Vault in Azure                                          |
| `DATABASE_SSL`, `DB_POOL_MAX`                                          | TLS to Postgres; connections per instance                                                         | TLS on in Azure; 5                                          |
| `STORAGE_ACCOUNT_NAME`                                                 | Blob Storage account (licences, shop media, order photos)                                         | empty locally: files go to `UPLOAD_DIR`                     |
| `JWT_SECRET`, `MERCHANT_SECRETS_KEY`                                   | Session signing; encryption of UPI IDs and PANs                                                   | 32+ characters; never change the second                     |
| `PUBLIC_ORIGIN`                                                        | The site's https address (links in SMS and owner approval links)                                  | —                                                           |
| `COOKIE_SECURE`, `COOKIE_SAMESITE`                                     | Session cookie; `None` only when web and API are on different domains                             | secure, `Lax`                                               |
| `OTP_DEV_MODE`, `DEMO_MODE`                                            | Test sign-in code and the role switcher; refused in production                                    | `false`                                                     |
| `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`                                  | Sign-in code SMS                                                                                  | required in production                                      |
| `SMS_PROVIDER`                                                         | Customer SMS: `msg91` sends, `log` only logs                                                      | `msg91` in prod, `log` elsewhere                            |
| `MSG91_ORDER_CHANGED_TEMPLATE_ID`                                      | "Your order changed" SMS (variables `shop`, `code`, `link`)                                       | required in production                                      |
| `ORDER_CHANGED_SMS_GAP_MINUTES`                                        | Minimum gap between two such SMS for one order                                                    | 15                                                          |
| `CALL_PROVIDER`                                                        | Shop → customer calls, masked (G9): `exotel` places them, `log` only logs, `off` hides the button | `off` in prod, `log` elsewhere                              |
| `EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID` | Exotel account and the ExoPhone customers see; `EXOTEL_API_HOST` picks the region                 | required when `CALL_PROVIDER=exotel`; host `api.exotel.com` |
| `PAYMENT_PROVIDER`                                                     | `razorpay` (production) or `mock`                                                                 | —                                                           |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`    | Platform-fee payments and their webhook                                                           | live keys in production                                     |
| `MOCK_PAYMENT_SECRET`                                                  | Signs mock payment events (dev only)                                                              | —                                                           |
| `PLATFORM_FEE_PAISE`                                                   | Flat platform fee per order, in paise                                                             | 3000 (₹30, guardrail G3)                                    |
| `UNPAID_ORDER_TTL_MINUTES`                                             | Minutes an order waits for its fee before it is cancelled                                         | 60                                                          |
| `ORDERING_ENABLED`                                                     | Online ordering switch (legal gate L1)                                                            | `false`                                                     |
| `SEASON_END`                                                           | Last day of the season (blocks, data purge)                                                       | —                                                           |
| `CATALOGUE_CACHE_SECONDS`                                              | Edge cache for the public catalogue                                                               | 10                                                          |

`/api/health` reports `config:false` (HTTP 503) in production until every required setting is
valid, so a deployment with a missing secret fails its smoke test instead of failing customers.

## Deploy to Azure

Follow [docs/DEPLOY.md](docs/DEPLOY.md). Order for a new environment:

1. **This repository:** run `deploy-infra.yml` (creates everything, including the Blob static
   website the frontend is served from), then `deploy-api.yml` (migrates the database, deploys
   the API).
2. **Frontend repository:** run its `deploy-web.yml`. It finds the storage account and Front Door
   from this repository's infrastructure deployment (`festive-infra`) in the same resource group.

## Shared code

`packages/shared` is copied into both repositories so each builds on its own. When you change
it, make the same change in the other repository (or publish it to a private npm registry and
depend on it from both).
