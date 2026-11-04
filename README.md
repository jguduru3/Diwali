# Xpress Pickup

Order from shops near you and collect at the shop's Express Pickup counter. Powered by Better
Analytics Pvt Ltd.

This branch holds the app as two projects, each built and deployed on its own:

| Folder                                             | What it is                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| [`xpress-pickup-backend`](xpress-pickup-backend)   | API (Azure Functions, Node 20), PostgreSQL migrations, Azure infrastructure |
| [`xpress-pickup-frontend`](xpress-pickup-frontend) | Web app (React PWA) for customers, merchants, agents and admins             |

Start with **[OVERVIEW.md](OVERVIEW.md)** (what the app does and how it is built) and
**[DEPLOYMENT.md](DEPLOYMENT.md)** (from an empty Azure subscription to a live site). Each
folder's README explains how to run it locally, its checks and settings.
`packages/shared` is copied into both; keep the two copies identical.

Note: the GitHub Actions workflows live in each folder's `.github` directory and do not run
from this layout; DEPLOYMENT.md step 1 splits the repository so they do.
