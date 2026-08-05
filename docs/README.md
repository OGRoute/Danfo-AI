---
description: >-
  Community-owned transit knowledge for Lagos, on Stellar — a multilingual AI
  transit agent grounded in route data the community stakes on, verifies, and
  earns for.
---

# Danfo 🚌

Lagos moves on informal *danfo* minibuses: no official map, no reliable fare
data, no operator publishing a feed. Every routing app for the city is either
wrong or empty.

Danfo fixes the data problem by putting economic weight behind it. Anyone can
correct a route or a fare, but a correction costs a **stake**; peers **attest**
to it during a challenge window; accepted corrections get the stake back plus a
**reward** from a sponsor pool, and rejected ones are **slashed** into that same
pool. The AI agent is the demand side — a voice-and-text assistant answering
routing questions in Yoruba, Igbo, Hausa, Pidgin, and English, grounded in the
knowledge base the protocol keeps honest.

> _"Mo fẹ lọ si Oshodi lati CMS"_ → the best danfo route, where to change, and a
> fare estimate — in Yoruba, with Nigerian-accented speech.

## Where to start

| You are | Read |
|---|---|
| Curious how the protocol works | [Lifecycle](protocol/lifecycle.md) → [Economics](protocol/economics.md) |
| A rider who just wants answers | [For riders](guides/riders.md) |
| Submitting or attesting corrections | [For contributors](guides/contributors.md) |
| Funding the reward pool | [For sponsors](guides/sponsors.md) |
| Building on or running Danfo | [Quick start](developers/quickstart.md) |
| Integrating the contracts | [danfo-registry](contracts/registry.md) · [danfo-rewards](contracts/rewards.md) |

## Repositories

| Repo | Contents |
|---|---|
| [Danfo-AI](https://github.com/OGRoute/Danfo-AI) | Application layer — web app, `@danfo/sdk`, indexer, speech service |
| [danfo-contracts](https://github.com/OGRoute/danfo-contracts) | Soroban contracts — `danfo-registry`, `danfo-rewards` |

## Status

Testnet software. The contracts are **unaudited** — do not stake value you
cannot lose. Parameter values quoted throughout these docs are launch defaults
and are admin-tunable; see [Economics](protocol/economics.md). Route data and
fares are community-maintained and approximate. Report security issues per
[SECURITY.md](https://github.com/OGRoute/Danfo-AI/blob/main/SECURITY.md).
