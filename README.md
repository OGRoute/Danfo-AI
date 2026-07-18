# Danfo 🚌 — Community-Owned Transit Knowledge for Lagos, on Stellar

**Ask for any Lagos route in Yoruba, Igbo, Hausa, Pidgin, or English — answered
from route data the community maintains and earns for maintaining.**

[![CI](https://github.com/OGRoute/Danfo-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/OGRoute/Danfo-AI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Soroban-testnet-brightgreen)](https://developers.stellar.org/docs/build/smart-contracts)

Lagos runs on informal *danfo* minibuses — no official map, no reliable fare
data. Danfo fixes the data problem with real economic weight:

1. **Stake** — a rider or driver submits a route/fare correction, staking a
   small amount via the [danfo-registry](https://github.com/OGRoute/danfo-contracts) Soroban contract.
2. **Attest** — peers approve or reject it during a 24-hour challenge window.
3. **Settle** — accepted corrections refund the stake; spam is slashed into
   the reward pool.
4. **Earn** — accepted corrections claim a reward from the sponsor-funded
   pool. With NGNC (Stellar's naira stablecoin) and SEP-24, rewards can become
   naira in a Nigerian bank account.

The AI agent is the demand side: a voice-and-text assistant that answers
routing questions **grounded in this community-verified knowledge base** — in
five languages, with Nigerian-accented speech.

> _"Mo fẹ lọ si Oshodi lati CMS"_ → the best danfo route, where to change, and
> a fare estimate, in Yoruba.

## How it works

```
User ──► apps/web (Next.js)
           │  chat: KB-grounded inference (any OpenAI-compatible endpoint)
           │  corrections feed: reads via indexer, falls back to chain
           │  writes: Freighter signs → Soroban RPC (never through the indexer)
           │
           ├──► indexer/ (Node + SQLite)  — syncs chain state, REST feed,
           │        finalize/claim crank
           │
           └──► Soroban contracts (danfo-contracts repo)
                    danfo-registry: submit (staked) → attest → finalize
                    danfo-rewards:  sponsor pool → claim per accepted correction
```

This monorepo holds the application layer; the contracts live in
[danfo-contracts](https://github.com/OGRoute/danfo-contracts).

| Workspace | What it is |
|---|---|
| `apps/web` | Next.js app — multilingual chat, voice, route map, corrections feed, Freighter wallet, fare payments |
| `packages/sdk` | `@danfo/sdk` — typed clients for both contracts (reads, XDR builders, submit helpers) |
| `indexer/` | Chain-state poller, finalize/claim crank, REST API (SQLite) |
| `services/speech` | Optional FastAPI service: YarnGPT2 TTS + Whisper STT for Nigerian languages |

## Quick start

Prereqs: Node 18+ (Node 20 recommended), a funded Stellar **testnet** account
([friendbot](https://friendbot.stellar.org)), and the deployed contract ids
from `danfo-contracts/scripts/deploy.sh`.

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # fill in contract ids + inference endpoint
npm run dev                                     # web app on :3000

# optional but recommended — feed + crank:
REGISTRY_CONTRACT=C... REWARDS_CONTRACT=C... INDEXER_SECRET_KEY=S... npm run dev:indexer
```

Open http://localhost:3000, tap the ⭐ button for the corrections feed, the mic
to talk.

## Status

Testnet software, unaudited contracts. See [SECURITY.md](SECURITY.md).

## Contributing

Issues are labeled by area (`web`, `sdk`, `indexer`, `speech`) and complexity.
Start with [CONTRIBUTING.md](CONTRIBUTING.md). Conventional commits, one
logical change per PR, CI must be green.

## License

[MIT](LICENSE)

_Route data and fares are community-maintained and approximate. Corrections
welcome — that's the whole point._
