# Deploying Diwali Express Pickup to Azure

The app is two independently deployable halves on one domain:

| Half     | Code       | Runs on                                                                                   | Pipeline                                                    |
| -------- | ---------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Frontend | `apps/web` | Azure **Blob Storage static website** (`$web`) + Front Door                               | [`deploy-web.yml`](../.github/workflows/deploy-web.yml)     |
| Backend  | `apps/api` | Azure Functions (Flex Consumption) + PostgreSQL + **Blob Storage** containers + Key Vault | [`deploy-api.yml`](../.github/workflows/deploy-api.yml)     |
| Infra    | `infra/`   | Bicep for both                                                                            | [`deploy-infra.yml`](../.github/workflows/deploy-infra.yml) |

Each pipeline runs on its own path changes (`apps/web/**`, `apps/api/**`, `infra/**`; all of
them on `packages/shared/**` for the two apps) and on a manual run. Push to `main` deploys **dev**;
a `v*` tag deploys **prod** (protect the `prod` GitHub environment with required reviewers). Run
the infrastructure pipeline once before the first app deploy, and before the app pipelines when a
release changes `infra/` (on a tag all three start together). See
[`apps/web/README.md`](../apps/web/README.md) and [`apps/api/README.md`](../apps/api/README.md)
for building and deploying each half by hand.

Front Door serves the web app at `/*` and the API at `/api/*` on the same domain, so the session
cookie stays first-party (`SameSite=Lax`). To host the web app elsewhere, put its origin in
`webOrigins` (Bicep: CORS with credentials and `SameSite=None` cookies) and build it with
`VITE_API_BASE=https://<api domain>/api` (GitHub variable `WEB_API_BASE`). The API itself is
still reachable only through Front Door.

| Resource                        | Purpose                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Front Door Standard             | HTTPS, custom domain, `/api/*` → Functions, `/*` → static site, security headers, SPA routing, edge cache for the public catalogue |
| Storage account (Blob)          | `$web` static website; private `licences` (licences, merchant documents), `shop-media`, `order-photos`; Functions deployment       |
| Function App (Flex Consumption) | API + timers, Node 20, managed identity, reachable **only** via Front Door; up to `functionMaxInstances`                           |
| PostgreSQL Flexible Server      | v16, TLS required; B1ms in dev, `params.prod.json` sizes prod (PgBouncer, zone-redundant HA)                                       |
| Key Vault                       | DB URLs, JWT secret, merchant-secrets key, MSG91 keys (Function App reads them by reference)                                       |
| Application Insights + alerts   | 5xx, Postgres CPU > 80 %, `/api/health` availability → email                                                                       |

## One-time setup (≈ 30 min)

1. **Azure subscription** with quota for Postgres Flexible Server and Flex Consumption in
   Central India. If Flex Consumption is not offered there, change `location` in
   `infra/params.*.json` (e.g. `southindia`) or ask Microsoft for quota.

2. **GitHub → Azure identity (OIDC, no stored secret)**

   ```bash
   az ad app create --display-name diwali-express-pickup-deploy
   az ad sp create --id <appId>
   # trust GitHub for each environment
   az ad app federated-credential create --id <appId> --parameters '{
     "name":"gh-dev","issuer":"https://token.actions.githubusercontent.com",
     "subject":"repo:<owner>/<repo>:environment:dev","audiences":["api://AzureADTokenExchange"]}'
   az ad app federated-credential create --id <appId> --parameters '{
     "name":"gh-prod","issuer":"https://token.actions.githubusercontent.com",
     "subject":"repo:<owner>/<repo>:environment:prod","audiences":["api://AzureADTokenExchange"]}'
   # it creates resource groups and role assignments
   az role assignment create --assignee <appId> --role Owner --scope /subscriptions/<subId>
   ```

3. **GitHub secrets** (repo or per environment):

   | Secret                     | Value                                                               |
   | -------------------------- | ------------------------------------------------------------------- |
   | `AZURE_CLIENT_ID`          | app (client) id from step 2                                         |
   | `AZURE_TENANT_ID`          | tenant id                                                           |
   | `AZURE_SUBSCRIPTION_ID`    | subscription id                                                     |
   | `AZURE_DEPLOYER_OBJECT_ID` | `az ad sp show --id <appId> --query id -o tsv`                      |
   | `PG_ADMIN_PASSWORD`        | strong password (migrations only)                                   |
   | `APP_DB_PASSWORD`          | strong password (runtime DB role `festive_app`)                     |
   | `JWT_SECRET`               | 48+ random characters (`openssl rand -base64 48`)                   |
   | `MERCHANT_SECRETS_KEY`     | 48+ random characters; encrypts merchants' YouPI-PG webhook secrets |
   | `MSG91_AUTH_KEY`           | MSG91 auth key (prod; may be empty in dev)                          |
   | `RAZORPAY_KEY_ID`          | Razorpay key ID: `rzp_live_…` for prod (`rzp_test_…` is refused)    |
   | `RAZORPAY_KEY_SECRET`      | Razorpay key secret                                                 |
   | `RAZORPAY_WEBHOOK_SECRET`  | secret of the webhook below                                         |

   Variable `MSG91_TEMPLATE_ID`: the DLT-approved OTP template id (must contain `##otp##`/`otp`).

   **Razorpay** (the ₹30 order fee and the ₹1,999 + GST subscription; sale money never goes
   through it, G3): Dashboard → Settings → API keys for the key ID and secret; Settings →
   Webhooks → add `https://<domain>/api/payments/webhook/razorpay` with the events
   `payment_link.paid`, `payment_link.expired`, `payment_link.cancelled`, `refund.processed` and
   `refund.failed`, and copy its secret. Customers and owners pay on Razorpay's hosted page and
   come back to their order or review page.

4. **Run the workflows** in order: Actions → _Deploy infrastructure_ → Run (env `dev`), then
   _Deploy API (backend)_ and _Deploy web (frontend)_. The summaries print the public URL.

5. **First admin in prod** (demo accounts are never seeded in prod):

   ```bash
   DATABASE_URL="$(az keyvault secret show --vault-name <kv> -n MIGRATION-DATABASE-URL --query value -o tsv)" \
     pnpm --filter api admin:grant +91XXXXXXXXXX
   ```

   (Add your IP to the Postgres firewall first, or run it from Cloud Shell.)

6. **Custom domain**: set `domain` in `infra/params.prod.json`, deploy, then add the TXT record
   `_dnsauth.<domain>` with the `customDomainValidationToken` output and a CNAME to the Front Door
   endpoint. The managed certificate is issued automatically.

## Demo mode vs production

|                                | dev (`params.dev.json`) | prod (`params.prod.json`) |
| ------------------------------ | ----------------------- | ------------------------- |
| `DEMO_MODE` (one-tap roles)    | on                      | **forced off**            |
| `OTP_DEV_MODE` (code `123456`) | on                      | **forced off**            |
| Demo seed data                 | yes                     | no                        |

Both flags are forced off for `prod` in Bicep **and** ignored by the API when `APP_ENV=prod`.
`pnpm db:seed` refuses to run with `APP_ENV=prod` or against an Azure database (set
`SEED_ALLOW_AZURE=true` only for the dev environment). The mock payment provider and the
simulated counter UPI are refused in prod.

**Production readiness check:** in prod `/api/health` answers `503 {"config": false}` until every
live setting is in place (no demo or dev OTP, JWT and merchant keys of 32+ characters, https
`PUBLIC_ORIGIN`, MSG91 keys, `PAYMENT_PROVIDER=razorpay` with live keys, storage account). The
deploy workflow's smoke test calls `/api/health`, so a deploy with a missing secret fails there,
and the missing setting names are written to Application Insights (`[config]`).
The dev site is public: treat it as a demo and never put real customer data in it.

## Before going live (checklist)

- [ ] Written legal opinion on the plan-list + slot model (SPEC §17).
- [ ] MSG91 DLT sender + OTP template approved; `MSG91_AUTH_KEY` and template id set; test an OTP.
- [ ] Razorpay account activated (KYC), live keys and webhook secret in GitHub secrets, webhook
      added; pay one ₹2,359 subscription and refund one ₹30 fee to check the whole loop.
- [ ] `/api/health` on prod returns `{"ok":true,"db":true,"config":true}`.
- [ ] Peak load test on staging with `loadtest/k6-peak.js` (docs/LOAD_TEST_REPORT.md).
- [ ] Partner shops onboarded: licence photos uploaded and verified in Admin → Licences.
- [ ] Holding-bay positions agreed with fire officer/police; grounds' bay counts and gate notes set.
- [ ] Telugu strings reviewed by a native speaker.
- [ ] `SEASON_END` correct (purge runs 90 days later).
- [ ] Restore drill: Postgres point-in-time restore to a new server and run `/api/health` against it.
