---
description: Get the monorepo running locally in a few minutes.
---

# Quick start

## Prerequisites

* **Node 18+** (Node 20 recommended — CI runs 20).
* A funded Stellar **testnet** account —
  [friendbot](https://friendbot.stellar.org) funds one for free.
* Deployed contract ids from `danfo-contracts/scripts/deploy.sh` — see
  [Deployment](../contracts/deployment.md).
* Optional: [Freighter](https://www.freighter.app/) for the wallet flows, Python
  3.10+ for the [speech service](speech.md).

## Install and run

```bash
git clone https://github.com/OGRoute/Danfo-AI.git
cd Danfo-AI
npm install                                    # npm workspaces — installs all packages

cp apps/web/.env.example apps/web/.env.local   # fill in contract ids + inference endpoint
npm run dev                                    # web app on :3000
```

Open [http://localhost:3000](http://localhost:3000). Tap ⭐ for the corrections
feed, the mic to talk.

Optional but recommended — run the feed and crank alongside it:

```bash
REGISTRY_CONTRACT=C... REWARDS_CONTRACT=C... INDEXER_SECRET_KEY=S... \
  npm run dev:indexer                          # REST API on :8787
```

## Workspace scripts

Run from the repo root:

| Command | Does |
|---|---|
| `npm run dev` | Web app dev server (`apps/web`) |
| `npm run dev:indexer` | Indexer with watch reload |
| `npm run build` | Production build of the web app |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint on the web app |
| `npm run typecheck` | `tsc --noEmit` across every workspace |

Workspaces: `apps/web`, `packages/sdk`, `indexer`. The speech service is Python
and lives outside the npm workspace set.

## What works without configuration

The app is built to degrade rather than break, and CI enforces it — the web
build must succeed with **no secrets set**. Concretely:

| Missing | Effect |
|---|---|
| Contract ids | Corrections panel shows "Stellar contract not configured"; chat and map still work |
| `INFERENCE_*` | Chat answers fail; feed and map still work |
| `YARNGPT_API_URL` | Voice output unavailable; text chat unaffected |
| Indexer | Feed falls back to direct chain reads (slower, same data) |

So you can start with just `npm install && npm run dev`, see the UI, and add
configuration as you need each feature.

## Before you open a PR

```bash
npm run typecheck && npm run lint && npm run build
```

Those are the three CI gates, plus a gitleaks secret scan. See
[Contributing](contributing.md).

## Next

* [Environment variables](environment.md) — every var, what happens without it
* [@danfo/sdk](sdk.md) — the contract client
* [Indexer API](indexer.md) — REST endpoints and the crank
* [Web app](web-app.md) — routes, components, API handlers
