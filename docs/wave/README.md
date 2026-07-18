# Danfo — Wave Resubmission Plan

Working docs for restructuring the rejected Danfo-AI submission into a
Stellar-first project, following the Stellar Wave Builder playbook.

| Phase | File | Status |
|---|---|---|
| 1 — Ecosystem landscape (live data, 2026-07-18) | [00-landscape.md](00-landscape.md) | Done |
| 2–3 — Rejection diagnosis, directions, verdict | [01-verdict.md](01-verdict.md) | Done |
| 4 — Naming, scoping, repo split | [02-restructure-plan.md](02-restructure-plan.md) | Done — **name needs owner sign-off** |
| 5 — Contract architecture spec | [03-contract-spec.md](03-contract-spec.md) | Done |
| 6 — Contracts build agent prompt | [04-contracts-agent-prompt.md](04-contracts-agent-prompt.md) | Ready to execute |
| 7 — App restructure agent prompt | [05-app-agent-prompt.md](05-app-agent-prompt.md) | Ready to execute |

## Remaining phases (executed after the builds above)

- **8 — Deploy:** run `danfo-contracts/scripts/deploy.sh` (registry → rewards →
  `set_config` slash_recipient → print ids); paste ids into app env
  (local `.env.local` + hosting UI).
- **9 — Hosting:** `apps/web` → Vercel; `indexer` → Render (Node runtime, root
  dir `indexer/`, build `npm ci && npm run build -w indexer`, start
  `npm run start -w indexer`); SQLite on a Render disk (or Render Postgres if
  moving off SQLite). Topology: user → web → indexer → db for reads; browser →
  Freighter → Soroban RPC for writes.
- **10 — Hygiene:** fetch 2–3 top approved repos (e.g. Trustless-Work, kindfi,
  Stellopay) and match their actual README pattern; branch protection with real
  CI job names; GitHub topics; batch issue creation via a `gh` script; tag
  `v0.1.0` with deployed contract ids in the release body.
- **11 — Docs site:** GitBook covering protocol lifecycle, worked economics
  (real stake/reward numbers at a cited XLM/NGN rate), full contract reference,
  per-persona guides, developer guide.
- **12 — Submission:** confirm not already listed (live check), assemble live
  app URL + both repos + explorer links for both contracts + docs + a demo
  video (submit → attest → finalize → claim → AI answer using the corrected
  data), repo-relationship blurb, planned-issues description. Note: 5-repo cap
  per wave, KYC required.
