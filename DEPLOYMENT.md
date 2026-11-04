# Deploying Xpress Pickup

From an empty Azure subscription to a live site. Plan about an hour for the first deployment,
plus the time the outside accounts take to approve you (MSG91 DLT, Razorpay KYC, GST).

The backend's own guide, [`xpress-pickup-backend/docs/DEPLOY.md`](xpress-pickup-backend/docs/DEPLOY.md),
has the same steps for the API and infrastructure in more detail, plus troubleshooting.

## What gets deployed

Everything runs in Azure (Central India), one resource group per environment, behind one domain.

```
                 https://<your domain>
                          │
                 Azure Front Door (HTTPS, cache, security headers)
                 ├── /*      → Blob Storage static website   ← xpress-pickup-frontend
                 └── /api/*  → Azure Functions (Node 20)     ← xpress-pickup-backend
                                    │
                        PostgreSQL 16 · Blob Storage · Key Vault · Application Insights
```

| Part           | Folder                                   | Deployed by (GitHub Actions)                  |
| -------------- | ---------------------------------------- | --------------------------------------------- |
| Infrastructure | `xpress-pickup-backend/infra/main.bicep` | `deploy-infra.yml` (backend)                  |
| API            | `xpress-pickup-backend/apps/api`         | `deploy-api.yml` (backend): migrates, deploys |
| Web app (PWA)  | `xpress-pickup-frontend/apps/web`        | `deploy-web.yml` (frontend)                   |

| Environment | Resource group    | Deploys on                       | Notes                                                         |
| ----------- | ----------------- | -------------------------------- | ------------------------------------------------------------- |
| `dev`       | `rg-festive-dev`  | every push to `main`, or by hand | demo mode, sign-in code `123456`, mock payments, no real data |
| `prod`      | `rg-festive-prod` | a `v*` tag, or by hand           | real SMS codes and payments; needs your approval to run       |

## Before you start

| You need                     | For                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Azure subscription (Owner)   | everything; quota for PostgreSQL Flexible Server and Functions Flex Consumption |
| GitHub account (admin)       | the two repositories, their secrets and Actions                                 |
| MSG91                        | sign-in SMS: auth key, DLT sender, approved OTP template (prod)                 |
| Razorpay (KYC done)          | the ₹30 order fee and the ₹2,499 subscription: **live** keys (prod)             |
| GSTIN and registered address | GST tax invoices for the fee and the subscription (prod)                        |
| A domain (optional at first) | one TXT and one CNAME record                                                    |
| Exotel or similar            | **not** needed: shop staff call customers from their own phone                  |

Install the Azure CLI and run `az login`. Node 20 and pnpm 9 are only needed to run things on
your own machine; the deployments run in GitHub Actions.

## Step 1 — Put each project in its own GitHub repository

Each folder is a complete project with its own `.github/workflows`. GitHub only runs workflows
from the root of a repository, so in the combined `Xpress-Pickup` repository they never run.
Split it once into two repositories (history is kept):

1. On GitHub, create two **empty** repositories, for example
   `jguduru3/xpress-pickup-backend` and `jguduru3/xpress-pickup-frontend`.
2. From the combined repository on your machine (`D:\Xpress Pickup`):

   ```bash
   git subtree split --prefix=xpress-pickup-backend -b backend-only
   git subtree split --prefix=xpress-pickup-frontend -b frontend-only
   git push https://github.com/jguduru3/xpress-pickup-backend.git backend-only:main
   git push https://github.com/jguduru3/xpress-pickup-frontend.git frontend-only:main
   ```

From now on, work and release in the two repositories. Keep `packages/shared` identical in
both (copy a change to the other repository in the same release).

## Step 2 — Let GitHub deploy to Azure (no stored password)

One Azure app registration serves both repositories, through OIDC federated credentials:

```bash
az ad app create --display-name xpress-pickup-deploy            # note the appId
az ad sp create --id <appId>
az role assignment create --assignee <appId> --role Owner --scope /subscriptions/<subscriptionId>
az ad sp show --id <appId> --query id -o tsv                     # the deployer object id
```

Then add four federated credentials (backend and frontend, `dev` and `prod`):

```bash
for repo in xpress-pickup-backend xpress-pickup-frontend; do
  for env in dev prod; do
    az ad app federated-credential create --id <appId> --parameters "{
      \"name\":\"${repo}-${env}\",\"issuer\":\"https://token.actions.githubusercontent.com\",
      \"subject\":\"repo:jguduru3/${repo}:environment:${env}\",\"audiences\":[\"api://AzureADTokenExchange\"]}"
  done
done
```

If Flex Consumption is not offered in Central India, change `location` in
`infra/params.dev.json` and `infra/params.prod.json` (backend), for example to `southindia`.

## Step 3 — GitHub environments

In **both** repositories: Settings → Environments → create **`dev`** and **`prod`**. On `prod`,
add yourself as a **Required reviewer**, so nothing reaches production without your click.

## Step 4 — Secrets and variables

Settings → Environments → _name_ → Secrets / Variables. Use different values for `dev` and
`prod`. Make random values with `openssl rand -base64 48`.

**Both repositories** (secrets): `AZURE_CLIENT_ID` (the appId), `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`.

**Backend repository**

| Secret                     | dev                       | prod                                                                         |
| -------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `AZURE_DEPLOYER_OBJECT_ID` | the deployer object id    | same                                                                         |
| `PG_ADMIN_PASSWORD`        | random                    | a different random                                                           |
| `APP_DB_PASSWORD`          | random                    | a different random                                                           |
| `JWT_SECRET`               | random, 48+ characters    | a different random, 48+ characters                                           |
| `MERCHANT_SECRETS_KEY`     | random, 48+ characters    | a different random; **never change it later** (it decrypts UPI IDs and PANs) |
| `MSG91_AUTH_KEY`           | may be empty              | MSG91 auth key                                                               |
| `RAZORPAY_KEY_ID`          | empty (dev uses a mock)   | `rzp_live_…` (test keys are refused)                                         |
| `RAZORPAY_KEY_SECRET`      | empty                     | live key secret                                                              |
| `RAZORPAY_WEBHOOK_SECRET`  | empty                     | a random string; you type the same into Razorpay in step 7                   |
| `VAPID_PRIVATE_KEY`        | empty (notifications off) | from `npx web-push generate-vapid-keys`                                      |

| Variable                          | Value                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `MSG91_TEMPLATE_ID`               | DLT-approved OTP template id (prod)                                                          |
| `MSG91_ORDER_CHANGED_TEMPLATE_ID` | DLT-approved Flow template for "your order changed", variables `shop`, `code`, `link` (prod) |
| `SUPPLIER_GSTIN`                  | Better Analytics' GSTIN, printed on tax invoices (required in prod)                          |
| `SUPPLIER_ADDRESS`                | Better Analytics' registered address, printed on tax invoices (required in prod)             |
| `VAPID_PUBLIC_KEY`                | the public key from the same `generate-vapid-keys` run; empty = notifications off            |

**Frontend repository** (variables, all optional)

| Variable           | Value                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| `WEB_API_BASE`     | leave unset (same domain, `/api`)                                                       |
| `WEB_COMPANY_URL`  | where "Powered by Better Analytics Pvt Ltd" links (default https://betteranalytics.in/) |
| `WEB_GAME_ENABLED` | `true` (default) or `false` to hide the BEA game icon                                   |

## Step 5 — First deployment to dev

Run these in GitHub → Actions with **env `dev`**, one after the other, waiting for each:

1. **Backend → Deploy infrastructure.** Creates `rg-festive-dev` and every resource (10–20
   minutes the first time). Its summary lists **publicUrl**.
2. **Backend → Deploy API (backend).** Builds, runs the database migrations, deploys, then waits
   for `/api/health`.
3. **Frontend → Deploy web (frontend).** Builds the app, uploads it, clears the Front Door cache.
   It finds the storage account and Front Door from step 1's deployment, so step 1 must be done.

Open **publicUrl**: the home page loads and `<publicUrl>/api/health` returns
`{"ok":true,"db":true,"config":true}`.

Demo data on dev (optional), from a machine whose IP is allowed on the dev database firewall:

```bash
export DATABASE_URL="$(az keyvault secret show --vault-name <dev key vault> -n MIGRATION-DATABASE-URL --query value -o tsv)"
SEED_ALLOW_AZURE=true pnpm db:seed          # in xpress-pickup-backend
```

## Step 6 — Production

1. In the backend's `infra/params.prod.json`, check `seasonEnd`, `alertEmail` and the capacity
   values (`postgresSkuName`, `functionMaxInstances`, `dbPoolMax`). Leave `domain` empty for now.
2. `orderingEnabled` stays `false` until the written legal opinion (rule L1). Shop listings, the
   walk-in order list, the counter, agents, subscriptions and invoices all work with it off.
3. Release by tagging **both** repositories with the same version:

   ```bash
   git tag v1.0.0 && git push origin v1.0.0     # in the backend repository
   git tag v1.0.0 && git push origin v1.0.0     # in the frontend repository
   ```

4. Approve the runs: backend **Deploy infrastructure** first and let it finish, then **Deploy
   API**, then frontend **Deploy web**. If the API's smoke test fails, a production setting is
   missing; see Troubleshooting.

## Step 7 — After the first production deploy

1. **First admin** (production has no demo accounts). Allow your IP on the prod database
   firewall for a moment, then in the backend repository:

   ```bash
   DATABASE_URL="$(az keyvault secret show --vault-name <prod key vault> -n MIGRATION-DATABASE-URL --query value -o tsv)" \
     pnpm --filter api admin:grant +91XXXXXXXXXX
   ```

   Remove the firewall rule and sign in on the site with that number.

2. **Razorpay webhook:** Dashboard → Settings → Webhooks → Add
   - URL `https://<site>/api/payments/webhook/razorpay`, secret = `RAZORPAY_WEBHOOK_SECRET`
   - events `payment_link.paid`, `payment_link.expired`, `payment_link.cancelled`,
     `refund.processed`, `refund.failed`
3. **Health:** `https://<site>/api/health` returns `{"ok":true,"db":true,"config":true}`.
4. **Money and invoices, end to end:** onboard one real shop through an agent and pay its
   **₹2,499** subscription on the owner's review link; open its tax invoice (shop → Invoices).
   Place one order, pay the ₹30 fee and open its tax invoice from the order page. Sale money
   never passes through the platform: customers pay the shop at its counter.

## Step 8 — Custom domain

1. Set `"domain": { "value": "pickup.example.in" }` in the backend's `infra/params.prod.json`,
   tag a new version and approve **Deploy infrastructure**.
2. Its summary shows **customDomainValidationToken**. In your DNS add
   - TXT `_dnsauth.pickup.example.in` = that token
   - CNAME `pickup.example.in` → the Front Door host (publicUrl without `https://`)
3. The certificate is issued within minutes to an hour. Update the Razorpay webhook URL.

## Releasing updates

| Change              | Do this                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| Anything, to dev    | push to `main` in that repository; the affected workflows run                        |
| A release to prod   | tag both repositories `vX.Y.Z`, approve (infrastructure first when `infra/` changed) |
| Only one part       | Actions → that workflow → Run workflow → env `prod`, "Use workflow from" the tag     |
| Shared code changed | release both repositories together                                                   |

Database migrations only go forward and run before the new API starts; add columns rather
than renaming or dropping in the same release.

**Rollback:** run **Deploy API** and/or **Deploy web** for `prod` from the previous tag. For
data mistakes, use PostgreSQL point-in-time restore to a new server and point `DATABASE-URL`
in Key Vault at it.

## Troubleshooting

| Symptom                                    | Cause and fix                                                                                                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health` shows `"config": false`      | A production setting is missing or unsafe. Application Insights → Logs → search `[config]` names it (for example `SUPPLIER_GSTIN`, a test Razorpay key, one VAPID key without the other). Fix it, re-run Deploy infrastructure, then Deploy API |
| `/api/health` shows `"db": false`          | Database unreachable: check the server and the `DATABASE-URL` secret                                                                                                                                                                            |
| Key Vault references "not resolved"        | Re-run Deploy infrastructure (the managed identity's access)                                                                                                                                                                                    |
| Deploy web cannot find the storage account | Run backend Deploy infrastructure for that environment first                                                                                                                                                                                    |
| Workflows never start                      | They are still in the combined repository; do step 1                                                                                                                                                                                            |
| Sign-in SMS never arrives                  | MSG91 DLT template or sender not approved, or wrong template id                                                                                                                                                                                 |
| Payments stay "waiting"                    | Razorpay webhook missing, wrong URL or wrong secret (Dashboard → Webhooks shows each delivery)                                                                                                                                                  |
| No notifications on phones                 | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` not set; on iPhone the app must be added to the Home Screen first                                                                                                                                      |
| The site shows an old version              | Re-run Deploy web (it clears the cache) and reload                                                                                                                                                                                              |

## Before going live

- [ ] Written legal opinion on online ordering (L1), only needed to switch `orderingEnabled` on.
- [ ] MSG91 DLT sender and templates approved; test a sign-in code.
- [ ] Razorpay activated with live keys and the webhook; pay one ₹2,499 subscription and refund
      one ₹30 fee.
- [ ] GST: `SUPPLIER_GSTIN` and `SUPPLIER_ADDRESS` set; SAC 996211 confirmed with the CA; one
      invoice of each kind checked. Agree with the CA how refunded fees are documented (credit
      notes are not generated by the app yet).
- [ ] `/api/health` on prod returns `{"ok":true,"db":true,"config":true}`.
- [ ] VAPID keys set if you want push notifications; test one on Android and one on iPhone.
- [ ] A payout account for agents' ₹1,000 transfers; admins record each UTR in Admin → Payouts.
- [ ] Partner shops' licences verified in Admin → Licences; entrance photos added.
- [ ] Holding bays and gate notes agreed with the fire officer and police.
- [ ] Telugu and Hindi text reviewed by native speakers.
- [ ] `SEASON_END` correct (the data purge runs 90 days later).
- [ ] A restore drill: point-in-time restore to a new server and `/api/health` against it.
- [ ] Load test on a staging copy (`xpress-pickup-backend/loadtest/k6-peak.js`).

## Running it on your own machine

Use three terminals (Node 20+ and pnpm 9).

```bash
# terminal 1: the database (Postgres 16 without Docker; or `pnpm db:up` with Docker). Keep it running.
cd xpress-pickup-backend
pnpm install
cp apps/api/local.settings.example.json apps/api/local.settings.json
pnpm db:embedded
```

```bash
# terminal 2: the API on http://localhost:7071. Keep it running.
cd xpress-pickup-backend
pnpm db:migrate && pnpm db:seed
pnpm dev:host
```

```bash
# terminal 3: the web app on http://localhost:5173 (it sends /api to :7071)
cd xpress-pickup-frontend
pnpm install
pnpm dev
```

Demo mode is on locally: pick a role from "Choose a role", or sign in with a seeded number and
the code `123456`.
