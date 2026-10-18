# Deploying Festive Diwali to Azure

Everything is created by [`infra/main.bicep`](../infra/main.bicep) and deployed by
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml):

| Resource                        | Purpose                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| Front Door Standard             | HTTPS, custom domain, `/api/*` → Functions, `/*` → static site, security headers, SPA routing |
| Storage account                 | `$web` static website; private `licences` container; Functions deployment                     |
| Function App (Flex Consumption) | API + timers, Node 20, managed identity, reachable **only** via Front Door                    |
| PostgreSQL Flexible Server B1ms | v16, TLS required, 7-day backups; app uses a least-privilege role                             |
| Key Vault                       | DB URLs, JWT secret, MSG91 keys (Function App reads them by reference)                        |
| Application Insights + alerts   | 5xx, Postgres CPU > 80 %, `/api/health` availability → email                                  |

Push to `main` deploys **dev**; a `v*` tag deploys **prod** (protect the `prod` GitHub environment
with required reviewers).

## One-time setup (≈ 30 min)

1. **Azure subscription** with quota for Postgres Flexible Server and Flex Consumption in
   Central India. If Flex Consumption is not offered there, change `location` in
   `infra/params.*.json` (e.g. `southindia`) or ask Microsoft for quota.

2. **GitHub → Azure identity (OIDC, no stored secret)**

   ```bash
   az ad app create --display-name festive-diwali-deploy
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

   | Secret                     | Value                                             |
   | -------------------------- | ------------------------------------------------- |
   | `AZURE_CLIENT_ID`          | app (client) id from step 2                       |
   | `AZURE_TENANT_ID`          | tenant id                                         |
   | `AZURE_SUBSCRIPTION_ID`    | subscription id                                   |
   | `AZURE_DEPLOYER_OBJECT_ID` | `az ad sp show --id <appId> --query id -o tsv`    |
   | `PG_ADMIN_PASSWORD`        | strong password (migrations only)                 |
   | `APP_DB_PASSWORD`          | strong password (runtime DB role `festive_app`)   |
   | `JWT_SECRET`               | 48+ random characters (`openssl rand -base64 48`) |
   | `MSG91_AUTH_KEY`           | MSG91 auth key (prod; may be empty in dev)        |

   Variable `MSG91_TEMPLATE_ID`: the DLT-approved OTP template id (must contain `##otp##`/`otp`).

4. **Run the workflow** (Actions → Deploy → Run, env `dev`). The summary prints the public URL.

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
The dev site is public: treat it as a demo and never put real customer data in it.

## Before going live (checklist)

- [ ] Written legal opinion on the plan-list + slot model (SPEC §17).
- [ ] MSG91 DLT sender + OTP template approved; `MSG91_AUTH_KEY` and template id set; test an OTP.
- [ ] Partner shops onboarded: licence photos uploaded and verified in Admin → Licences.
- [ ] Holding-bay positions agreed with fire officer/police; grounds' bay counts and gate notes set.
- [ ] Telugu strings reviewed by a native speaker.
- [ ] `SEASON_END` correct (purge runs 90 days later).
- [ ] Restore drill: Postgres point-in-time restore to a new server and run `/api/health` against it.
