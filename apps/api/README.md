# API (backend)

Azure Functions v4 (Node 20, one esbuild bundle) on **Flex Consumption**, PostgreSQL 16 (Drizzle),
files in **Azure Blob Storage** through the Function App's managed identity, secrets from Key Vault.
Reachable only through Front Door (`/api/*`).

## Build and run on its own

```bash
pnpm install
cp apps/api/local.settings.example.json apps/api/local.settings.json
pnpm db:embedded                     # Postgres 16 without Docker (keep running)
pnpm db:migrate && pnpm db:seed
pnpm --filter api dev                # http://localhost:7071/api (Azurite for blobs)
pnpm --filter api build              # → apps/api/dist (zip with host.json + package.json)
pnpm test:int                        # integration tests on a throwaway Postgres
```

## Blob Storage

| Container      | Access  | Holds                                                   |
| -------------- | ------- | ------------------------------------------------------- |
| `licences`     | private | licence photos, merchant documents (`docs/<shop>/<id>`) |
| `shop-media`   | API     | product photos, served by `GET /api/media/...`          |
| `order-photos` | private | packed-order photos                                     |
| `deployments`  | private | Flex Consumption deployment packages                    |

Locally (no `STORAGE_ACCOUNT_NAME`) files go to `UPLOAD_DIR` (`.uploads/`).

## Configuration (Function App settings; Bicep sets them)

| Setting                   | Notes                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`            | Key Vault; PgBouncer port 6432 on General Purpose and above                |
| `JWT_SECRET`              | Key Vault, ≥ 32 characters                                                 |
| `MERCHANT_SECRETS_KEY`    | Key Vault; encrypts merchant webhook secrets, UPI IDs and PANs (G9)        |
| `STORAGE_ACCOUNT_NAME`    | the data storage account (blob containers above)                           |
| `ORDERING_ENABLED`        | L1 legal gate: `false` in prod until the legal opinion                     |
| `PAYMENT_PROVIDER`        | fee adapter for the ₹30 fee and the merchant subscription; `mock` dev only |
| `DB_POOL_MAX`             | connections per instance                                                   |
| `CATALOGUE_CACHE_SECONDS` | public list cache per instance (0 = off)                                   |
| `COOKIE_SAMESITE`         | `None` only when the web app is on another domain (Bicep `webOrigins`)     |

## Deploy

`.github/workflows/deploy-api.yml` builds, migrates and zip-deploys on every change under
`apps/api/**` or `packages/shared/**` (dev on `main`, prod on a `v*` tag). By hand:

```bash
pnpm --filter api build
cd apps/api && zip -qr ../../api.zip host.json package.json dist && cd ../..
DATABASE_URL="<migration url from Key Vault>" pnpm --filter api db:migrate
az functionapp deployment source config-zip -g <rg> -n <function app> --src api.zip
```
