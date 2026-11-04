# Xpress Pickup — frontend

The web app (PWA) for customers, merchants, packers, gig agents and admins.
Powered by Better Analytics Pvt Ltd. The API lives in the separate **xpress-pickup-backend**
repository.

| Folder            | What it is                                                                        |
| ----------------- | --------------------------------------------------------------------------------- |
| `apps/web`        | React 18 + Vite + Tailwind; English, Telugu and Hindi in `src/i18n`               |
| `packages/shared` | Types, validation and rules shared with the backend (keep both copies identical)  |
| `scripts`         | `copy-lint` (banned words, G5) and `i18n-lint` (no hard-coded text)               |
| `.github`         | CI, and `deploy-web.yml` (build, upload to Blob static website, purge Front Door) |

## Run it locally

Needs Node 20+, pnpm 9, and the backend running (see its README).

```bash
pnpm install
pnpm dev     # http://localhost:5173; /api goes to http://localhost:7071
# Backend elsewhere: API_PROXY_TARGET=http://localhost:7080 pnpm dev
```

## Checks

```bash
pnpm check   # typecheck, lint, formatting, copy-lint, i18n-lint, unit tests
pnpm build   # apps/web/dist
```

## Settings

Build-time settings (`apps/web/.env.example`). Business values such as the platform fee come
from the API, so they are never built into the app.

| Setting             | What it does                                                                                                                                                 | Default                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `VITE_API_BASE`     | Where the API is. Same domain through Front Door: `/api`. Another domain: `https://api.example.in/api` (then set `webOrigins` in the backend's Bicep params) | `/api`                                 |
| `VITE_COMPANY_URL`  | Company website the footer's "Powered by" line links to                                                                                                      | `https://betteranalytics.in/`          |
| `VITE_GAME_ENABLED` | The floating BEA game icon and `/play`                                                                                                                       | `true`                                 |
| `VITE_GAME_URL`     | Where the game icon and `/play` go (the BEA game is hosted separately)                                                                                       | `https://bea-game.betteranalytics.in/` |
| `API_PROXY_TARGET`  | Local dev only: where the dev server forwards `/api`                                                                                                         | `http://localhost:7071`                |

In GitHub these are the environment variables `WEB_API_BASE`, `WEB_COMPANY_URL` and
`WEB_GAME_ENABLED` (see `deploy-web.yml`).

## Deploy to Azure

Deploy the backend repository's infrastructure first: it creates the Blob Storage static
website and Front Door this app is served from. Then run `deploy-web.yml` (push to `main` → dev,
tag `v*` → prod). It needs the same GitHub environment secrets as the backend
(`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`).

## Shared code

`packages/shared` is copied into both repositories so each builds on its own. When you change
it, make the same change in the other repository (or publish it to a private npm registry).
