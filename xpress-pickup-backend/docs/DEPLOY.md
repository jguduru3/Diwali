# Deploying Xpress Pickup to Azure

A step-by-step guide from an empty Azure subscription to a live production site. Plan about
an hour for the first deployment, plus the time the external accounts (MSG91 DLT, Razorpay KYC)
take to be approved.

## How it fits together

The app is two independently deployable halves on one domain:

| Half     | Code       | Runs on                                                                                   | Pipeline                                                    |
| -------- | ---------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Frontend | `apps/web` | Azure **Blob Storage static website** (`$web`) + Front Door                               | [`deploy-web.yml`](../.github/workflows/deploy-web.yml)     |
| Backend  | `apps/api` | Azure Functions (Flex Consumption) + PostgreSQL + **Blob Storage** containers + Key Vault | [`deploy-api.yml`](../.github/workflows/deploy-api.yml)     |
| Infra    | `infra/`   | Bicep for both                                                                            | [`deploy-infra.yml`](../.github/workflows/deploy-infra.yml) |

| Resource                        | Purpose                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Front Door Standard             | HTTPS, custom domain, `/api/*` → Functions, `/*` → static site, security headers, SPA routing, edge cache for the public catalogue |
| Storage account (Blob)          | `$web` static website; private `licences` (licences, merchant documents), `shop-media`, `order-photos`; Functions deployment       |
| Function App (Flex Consumption) | API + timers, Node 20, managed identity, reachable **only** via Front Door; up to `functionMaxInstances`                           |
| PostgreSQL Flexible Server      | v16, TLS required; B1ms in dev, `params.prod.json` sizes prod (PgBouncer, zone-redundant HA)                                       |
| Key Vault                       | DB URLs, JWT secret, merchant-secrets key, MSG91 and Razorpay keys (the Function App reads them by reference)                      |
| Application Insights + alerts   | 5xx, Postgres CPU > 80 %, `/api/health` availability → email (`alertEmail` in the params file)                                     |

Two environments, each in its own resource group:

| Environment | Resource group    | Deployed by                                 | Params file              | Notes                                                         |
| ----------- | ----------------- | ------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| `dev`       | `rg-festive-dev`  | every push to `main`, or a manual run       | `infra/params.dev.json`  | demo mode, code `123456`, mock payments; public: no real data |
| `prod`      | `rg-festive-prod` | a `v*` tag (e.g. `v1.0.0`), or a manual run | `infra/params.prod.json` | real sign-in codes and payments; sized for the peak           |

Each pipeline also runs on its own path changes (`apps/web/**`, `apps/api/**`, `infra/**`;
`packages/shared/**` triggers both apps). Front Door serves the web app at `/*` and the API at
`/api/*` on the same domain, so the session cookie stays first-party (`SameSite=Lax`).

## Step 0 — Accounts to have ready

| Account                    | What you need from it                                                                                         | Needed for                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Azure subscription         | Owner rights; quota for PostgreSQL Flexible Server and Functions Flex Consumption in Central India            | dev and prod                 |
| GitHub repo                | Admin rights (secrets, environments, Actions)                                                                 | dev and prod                 |
| MSG91                      | Auth key, a DLT-registered sender and an approved OTP template (the template must contain the `otp` variable) | prod (sign-in SMS)           |
| Razorpay                   | Activated account (KYC done), **live** API key ID and secret                                                  | prod (₹30 fee, subscription) |
| Domain (optional at first) | Access to its DNS (one TXT and one CNAME record)                                                              | prod                         |

Install the Azure CLI (`az`) and sign in with `az login`. Everything else runs in GitHub Actions.

## Step 1 — Let GitHub deploy to Azure (OIDC, no stored password)

```bash
az ad app create --display-name xpress-pickup-deploy          # note the appId
az ad sp create --id <appId>
az ad app federated-credential create --id <appId> --parameters '{
  "name":"gh-dev","issuer":"https://token.actions.githubusercontent.com",
  "subject":"repo:jguduru3/Xpress-Pickup:environment:dev","audiences":["api://AzureADTokenExchange"]}'
az ad app federated-credential create --id <appId> --parameters '{
  "name":"gh-prod","issuer":"https://token.actions.githubusercontent.com",
  "subject":"repo:jguduru3/Xpress-Pickup:environment:prod","audiences":["api://AzureADTokenExchange"]}'
# it creates resource groups and role assignments
az role assignment create --assignee <appId> --role Owner --scope /subscriptions/<subscriptionId>
az ad sp show --id <appId> --query id -o tsv                          # the deployer object id
```

If Flex Consumption is not offered in Central India, change `location` in both
`infra/params.*.json` files (for example `southindia`) or ask Microsoft for quota.

## Step 2 — GitHub environments

GitHub → Settings → Environments: create **`dev`** and **`prod`**. On `prod`, add
**Required reviewers** (you) so nothing reaches production without an approval click.

## Step 3 — Secrets and variables

Set these as **environment secrets** (different values for `dev` and `prod`), under
Settings → Environments → _name_ → Secrets. Generate random values with `openssl rand -base64 48`.

| Secret                     | dev                                 | prod                                                                                              |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`          | appId from step 1                   | same                                                                                              |
| `AZURE_TENANT_ID`          | your tenant id                      | same                                                                                              |
| `AZURE_SUBSCRIPTION_ID`    | your subscription id                | same                                                                                              |
| `AZURE_DEPLOYER_OBJECT_ID` | object id from step 1               | same                                                                                              |
| `PG_ADMIN_PASSWORD`        | random (migrations only)            | **different** random                                                                              |
| `APP_DB_PASSWORD`          | random (runtime role `festive_app`) | **different** random                                                                              |
| `JWT_SECRET`               | random, 48+ characters              | **different** random, 48+ characters                                                              |
| `MERCHANT_SECRETS_KEY`     | random, 48+ characters              | **different** random, 48+ characters; never change it later (it decrypts stored UPI IDs and PANs) |
| `MSG91_AUTH_KEY`           | may be empty                        | MSG91 auth key                                                                                    |
| `RAZORPAY_KEY_ID`          | empty (dev uses the mock)           | `rzp_live_…` (test keys are refused)                                                              |
| `RAZORPAY_KEY_SECRET`      | empty                               | live key secret                                                                                   |
| `RAZORPAY_WEBHOOK_SECRET`  | empty                               | a random string; you type the same one into Razorpay in step 7                                    |
| `VAPID_PRIVATE_KEY`        | empty (push off)                    | from `npx web-push generate-vapid-keys` (with the public key below)                               |

**Variables** (Settings → Environments → _name_ → Variables):

| Variable                          | Value                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `MSG91_TEMPLATE_ID`               | the DLT-approved OTP template id (prod)                                                                                           |
| `SUPPLIER_GSTIN`                  | the platform GSTIN printed on GST tax invoices (required in prod)                                                                 |
| `SUPPLIER_ADDRESS`                | the platform registered address printed on tax invoices (required in prod)                                                        |
| `VAPID_PUBLIC_KEY`                | web push public key (with the `VAPID_PRIVATE_KEY` secret); empty = notifications off                                              |
| `WEB_API_BASE`                    | leave unset (same domain). Only for a web app on another domain: `https://<api domain>/api`, plus `webOrigins` in the params file |
| `MSG91_ORDER_CHANGED_TEMPLATE_ID` | DLT-approved MSG91 Flow template for "your order changed" SMS, with variables `shop`, `code`, `link` (prod)                       |
| `WEB_COMPANY_URL`                 | company website the footer's "Powered by" line links to (default https://betteranalytics.in/)                                     |
| `WEB_GAME_ENABLED`                | `true` (default) or `false` to hide the game                                                                                      |

## Step 4 — First deployment to dev

GitHub → Actions, run these in order with **env `dev`** and wait for each to finish:

1. **Deploy infrastructure** — creates `rg-festive-dev` and every resource (10–20 minutes the
   first time). Its summary lists the outputs, including **publicUrl**.
2. **Deploy API (backend)** — builds the API, runs the database migrations, creates the
   least-privilege app role, zip-deploys, then calls `/api/health` until it answers.
3. **Deploy web (frontend)** — builds the PWA, uploads it to `$web`, purges the Front Door cache.

Open the **publicUrl**: the home page should load and `<publicUrl>/api/health` should return
`{"ok":true,"db":true,"config":true}`.

**Optional: demo data on dev.** Seeding is refused on any Azure database unless you allow it
explicitly. From a machine whose IP you have added to the dev Postgres firewall:

```bash
export DATABASE_URL="$(az keyvault secret show --vault-name <dev key vault> -n MIGRATION-DATABASE-URL --query value -o tsv)"
SEED_ALLOW_AZURE=true pnpm db:seed
```

## Step 5 — Production settings

1. In `infra/params.prod.json` check `seasonEnd`, `alertEmail` and the capacity values
   (`postgresSkuName`, `functionMaxInstances`, `dbPoolMax`). `paymentProvider` is already
   `razorpay`; `demoMode` and `otpDevMode` are forced off in prod whatever the file says.
2. **Domain:** leave `domain` empty for the first deploy; the site works on the Front Door
   address (`https://festive-prod-….azurefd.net`) and that address is used for links and
   payment return pages. Add your domain in step 8.
3. `orderingEnabled` stays `false` (L1) until the written legal opinion. Plan-list mode, shop
   listings, the counter, agents, payouts and subscriptions all work with ordering off.

## Step 6 — Deploy production

Tag the commit you want to release and push the tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The three workflows start for `prod` and wait for your approval (required reviewers). Approve
**Deploy infrastructure** first and let it finish, then the API and web workflows. If the API
workflow's smoke test fails, production is not fully configured: see Troubleshooting.

## Step 7 — After the first production deploy

1. **First admin** (production never has demo accounts). Add your IP to the prod Postgres
   firewall (Azure portal → the server → Networking), or use Cloud Shell, then:

   ```bash
   DATABASE_URL="$(az keyvault secret show --vault-name <prod key vault> -n MIGRATION-DATABASE-URL --query value -o tsv)" \
     pnpm --filter api admin:grant +91XXXXXXXXXX
   ```

   Remove the firewall rule afterwards. Sign in at the site with that number (a real SMS code).

2. **Razorpay webhook:** Razorpay Dashboard → Settings → Webhooks → Add:
   - URL: `https://<your domain or publicUrl>/api/payments/webhook/razorpay`
   - Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment_link.paid`, `payment_link.expired`, `payment_link.cancelled`,
     `refund.processed`, `refund.failed`
3. **Check:** `https://<site>/api/health` returns `{"ok":true,"db":true,"config":true}`.
4. **End-to-end money check:** onboard one real shop through an agent, pay its ₹2,359
   subscription on the review link, and see it marked paid (Admin → Subscriptions / the agent's
   page). Sale money never goes through Razorpay: customers pay shops at the counter (G3).

## Step 8 — Custom domain

1. Set `"domain": { "value": "pickup.example.in" }` in `infra/params.prod.json`, commit, tag
   (`v1.0.1`) and approve **Deploy infrastructure**.
2. Its summary shows **customDomainValidationToken**. In your DNS add:
   - TXT `_dnsauth.pickup.example.in` = that token
   - CNAME `pickup.example.in` → the Front Door endpoint host (the old publicUrl without `https://`)
3. Front Door validates the domain and issues the certificate (minutes to an hour). Then update
   the Razorpay webhook URL to the new domain.

## Releasing updates

| Change            | What to do                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Anything, to dev  | push to `main`; the affected workflows run on their own                                          |
| A release to prod | `git tag vX.Y.Z && git push origin vX.Y.Z`, approve the runs (infra first when `infra/` changed) |
| Only one half     | Actions → that workflow → Run workflow → env `prod`, "Use workflow from" the tag                 |

Database migrations only move forward and run before the new API starts; write them so the
previous API version still works (add columns, do not rename or drop in the same release).

**Rollback:** run _Deploy API_ and/or _Deploy web_ manually for `prod`, choosing the previous tag
under "Use workflow from". Postgres has point-in-time restore (Azure portal → server → Restore)
for data mistakes; restore to a new server and repoint `DATABASE-URL` in Key Vault.

## Troubleshooting

| Symptom                                                      | Cause and fix                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API smoke test fails; `/api/health` shows `"config": false`  | A production setting is missing or unsafe. Application Insights → Logs → search `[config]` lists exactly which (for example a test Razorpay key or an empty MSG91 key). Fix the GitHub secret, re-run Deploy infrastructure, then Deploy API |
| `/api/health` shows `"db": false`                            | Database unreachable: check the server is running and the `DATABASE-URL` secret; PgBouncer port 6432 on General Purpose and above                                                                                                            |
| Key Vault references show "not resolved" in the Function App | The infra run did not finish or the managed identity lost its role: re-run Deploy infrastructure                                                                                                                                             |
| Deploy infrastructure fails on quota or SKU                  | Change `location` or the SKU in the params file, or request quota                                                                                                                                                                            |
| Sign-in SMS never arrives                                    | MSG91 DLT template or sender not approved, or the template id is wrong; check the MSG91 delivery log                                                                                                                                         |
| Payments stay "waiting" after paying                         | The Razorpay webhook is missing, points at the wrong URL, or has a different secret: Razorpay Dashboard → Webhooks shows each delivery and its response                                                                                      |
| The site shows an old version                                | Front Door cache: re-run Deploy web (it purges) and reload                                                                                                                                                                                   |

## Demo mode vs production

|                                | dev (`params.dev.json`)              | prod (`params.prod.json`) |
| ------------------------------ | ------------------------------------ | ------------------------- |
| `DEMO_MODE` (one-tap roles)    | on                                   | **forced off**            |
| `OTP_DEV_MODE` (code `123456`) | on                                   | **forced off**            |
| Payments                       | mock test page                       | Razorpay (live keys only) |
| Demo seed data                 | on request (`SEED_ALLOW_AZURE=true`) | **refused**               |

The flags are forced off for `prod` in Bicep **and** ignored by the API when `APP_ENV=prod`.
`pnpm db:seed` refuses `APP_ENV=prod` and Azure databases unless `SEED_ALLOW_AZURE=true`. The
mock payment provider and the simulated counter UPI are refused in prod.

**Production readiness check:** in prod `/api/health` answers `503 {"config": false}` until every
live setting is in place (no demo or dev OTP, JWT and merchant keys of 32+ characters, https
`PUBLIC_ORIGIN`, MSG91 keys, `PAYMENT_PROVIDER=razorpay` with live keys, storage account). The
deploy smoke test calls `/api/health`, so a deploy with a missing secret fails there.

## Before going live (checklist)

- [ ] Written legal opinion on online ordering (L1) — only needed to switch `orderingEnabled` on.
- [ ] MSG91 DLT sender + OTP template approved; `MSG91_AUTH_KEY` and template id set; test an OTP.
- [ ] Razorpay account activated (KYC), live keys and webhook secret in GitHub secrets, webhook
      added; pay one ₹2,359 subscription and refund one ₹30 fee to check the whole loop.
- [ ] GST: `SUPPLIER_GSTIN` and `SUPPLIER_ADDRESS` set; SAC 996211 on the fee and subscription
      invoices confirmed with the CA; open one invoice of each kind and check it.
- [ ] `/api/health` on prod returns `{"ok":true,"db":true,"config":true}`.
- [ ] Peak load test on a staging copy with `loadtest/k6-peak.js` (docs/LOAD_TEST_REPORT.md).
- [ ] A payout account (bank or UPI) for the agents' ₹1,000 transfers; admins record each UTR in Admin → Payouts.
- [ ] Partner shops onboarded: licence photos uploaded and verified in Admin → Licences.
- [ ] Holding-bay positions agreed with fire officer/police; grounds' bay counts and gate notes set.
- [ ] Telugu and Hindi strings reviewed by native speakers.
- [ ] `SEASON_END` correct (the purge runs 90 days later).
- [ ] Restore drill: Postgres point-in-time restore to a new server and run `/api/health` against it.
