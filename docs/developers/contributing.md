---
description: How work is scoped, reviewed, and merged.
---

# Contributing

The authoritative guide is
[CONTRIBUTING.md](https://github.com/OGRoute/Danfo-AI/blob/main/CONTRIBUTING.md)
in the repo — this page is the short version and the surrounding context.

## Where to work

| Change | Repo / workspace |
|---|---|
| UI, chat, voice, map, API routes | `apps/web` — [Web app](web-app.md) |
| Contract client, codecs, tx plumbing | `packages/sdk` — [@danfo/sdk](sdk.md) |
| Feed, crank, REST API | `indexer/` — [Indexer](indexer.md) |
| TTS/STT wrapper | `services/speech` — [Speech service](speech.md) |
| Contracts | [danfo-contracts](https://github.com/OGRoute/danfo-contracts) — separate repo |

You do not need every prerequisite. Frontend and API work needs Node 20 only;
contract work additionally needs Rust with the `wasm32` target plus the Stellar
CLI; the speech service needs Python 3.11 and ffmpeg.

Issues are labeled by area (`web`, `sdk`, `indexer`, `speech`) and by complexity.

## Standards

* **Conventional commits** — `feat(web):`, `fix(sdk):`, `docs:`, `chore(ci):`.
* **One logical change per PR.** The commit history in this repo is the
  reference for the expected granularity.
* **CI must be green.**

## CI

Two jobs run on every PR and on pushes to `main` (Node 20, npm cache,
in-progress runs cancelled on new pushes):

| Job | Steps |
|---|---|
| Types, lint & build | `npm ci` → `npm run typecheck` (all workspaces) → `npm run lint` → `npm run build` |
| Secret scan | gitleaks over full history |

Reproduce locally before pushing:

```bash
npm run typecheck && npm run lint && npm run build
```

**The build runs with no secrets set.** That is deliberate and load-bearing: a
feature that throws when its API key is missing fails CI. New integrations must
degrade — hide the control, return an empty result, fall back to another source
— never crash the page. See the degradation table in
[Architecture](../protocol/architecture.md#degradation).

## Docs

These docs live in `docs/` and are published with GitBook via `.gitbook.yaml`.
Add a page by creating the file and adding it to
[`docs/SUMMARY.md`](https://github.com/OGRoute/Danfo-AI/blob/main/docs/SUMMARY.md)
— GitBook builds navigation from that file, so a page missing from it will not
appear.

If you change a contract signature, parameter default, env var, or REST
response, update the corresponding page in the same PR. Two things go stale
fastest and are worth checking when you touch them: the launch parameters in
[Economics](../protocol/economics.md) (including the dated FX figures) and the
variable tables in [Environment](environment.md).

## Security

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](https://github.com/OGRoute/Danfo-AI/blob/main/SECURITY.md). The
contracts are unaudited testnet software.

Also see the
[Code of Conduct](https://github.com/OGRoute/Danfo-AI/blob/main/CODE_OF_CONDUCT.md).
