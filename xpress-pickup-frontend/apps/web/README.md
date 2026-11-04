# Web app (frontend)

React PWA (Vite, Tailwind, TanStack Query, i18next en/te/hi). It is a static site: the build in
`dist/` is uploaded to an **Azure Blob Storage static website** (`$web` container) and served
through **Azure Front Door**, which also routes `/api/*` to the backend on the same domain.

## Build and run on its own

```bash
pnpm install
pnpm --filter web dev        # http://localhost:5173, /api proxied to http://localhost:7071
pnpm --filter web build      # → apps/web/dist
pnpm --filter web test
```

## Configuration (build time)

| Variable        | Default | Use                                                                                  |
| --------------- | ------- | ------------------------------------------------------------------------------------ |
| `VITE_API_BASE` | `/api`  | Same domain (Front Door). For an API on another domain: `https://api.example.in/api` |

See `.env.example`. When the API is on another domain, the backend must list this site in
`webOrigins` (Bicep) so it allows the origin and sends `SameSite=None` session cookies.

## Deploy

`.github/workflows/deploy-web.yml` builds and uploads on every change under `apps/web/**` or
`packages/shared/**` (dev on `main`, prod on a `v*` tag). By hand:

```bash
pnpm --filter web build
az storage blob upload-batch --account-name <web storage account> --auth-mode login \
  -d '$web' -s apps/web/dist --overwrite --pattern 'assets/*' \
  --content-cache-control "public,max-age=31536000,immutable"
az storage blob upload-batch --account-name <web storage account> --auth-mode login \
  -d '$web' -s apps/web/dist --overwrite --pattern '[!a]*' --content-cache-control "no-cache"
az afd endpoint purge -g <rg> --profile-name <afd profile> --endpoint-name <endpoint> \
  --content-paths '/index.html' '/sw.js' '/manifest.webmanifest' '/'
```
