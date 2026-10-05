# DanfoAI Admin

A separate dashboard for the people maintaining DanfoAI: what riders are
telling us, and what to fix next. It runs as its own deployment so the
rider-facing app stays exactly that.

It keeps no database. Rider corrections live on 0G Chain and the route data
lives with the app that serves it, so this reads the live picture from
`/api/admin/overview` server-side and never exposes the admin token to a
browser.

## What it shows

- **What riders have changed** — corrections that reached the agreement
  threshold and are live in answers now.
- **Routes riders dispute** — thumbs-down and "that route doesn't run" reports.
  These are demoted in planning until someone checks them on the ground.
- **Rider feedback** — every correction read back from 0G Chain, newest first.
- **Questions DanfoAI couldn't answer** — the best list of what to add next.
  Held in the app's memory, so it's a recent sample, not a full history.
- **Fare data quality** — how much of the BRT and LAMATA table is an operator's
  published fare rather than an estimate, and which services still aren't.

## Running it

```bash
cp .env.example .env     # fill in the four values
npm install
npm run dev              # http://localhost:3000
```

| Variable | What it is |
| --- | --- |
| `DANFO_API_BASE` | Where the rider-facing app lives, e.g. `https://danfo-ai.vercel.app` |
| `ADMIN_TOKEN` | Must match `ADMIN_TOKEN` in the main app's environment |
| `ADMIN_PASSWORD` | Password for signing in here |
| `ADMIN_SESSION_SECRET` | Signs the session cookie — `openssl rand -hex 32` |

Node 22.19+ (same as the main app).

## Deploying

This must be its **own** Vercel project. If `admin/.vercel` is missing, the CLI
walks up to the repository root and deploys this app over the rider-facing
site at danfo-ai.vercel.app — so link it first and check the link before
deploying:

```bash
cd admin
vercel link --yes --project danfo-ai-admin   # creates a NEW project
cat .vercel/project.json                     # MUST read danfo-ai-admin
```

Do not answer "yes" to *link to an existing project* — that is what points this
directory at the main app. With the link confirmed, add the four variables
(`DANFO_API_BASE` as Config, the other three as Secret) one at a time, since
the CLI prompts for each value:

```bash
vercel env add DANFO_API_BASE production
vercel env add ADMIN_TOKEN production
vercel env add ADMIN_PASSWORD production
vercel env add ADMIN_SESSION_SECRET production
vercel deploy --prod --yes
```

The sign-in is a single shared password behind a signed HTTPOnly cookie, and
every page sends `X-Robots-Tag: noindex`. The dashboard is read-only: it has no
write access to the route data or the contract, so the worst a leaked password
costs is visibility of aggregate feedback. Rotate it by changing
`ADMIN_PASSWORD` and redeploying.
