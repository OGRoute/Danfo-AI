---
description: What each piece does, and which way the data flows.
---

# Architecture

```
User ──► apps/web (Next.js)
           │  chat: KB-grounded inference (any OpenAI-compatible endpoint)
           │  corrections feed: reads via indexer, falls back to chain
           │  writes: Freighter signs → Soroban RPC (never through the indexer)
           │
           ├──► indexer/ (Node + SQLite) — chain-state poller, REST feed,
           │        finalize/claim crank
           │
           ├──► services/speech (optional FastAPI) — YarnGPT2 TTS, Whisper STT
           │
           └──► Soroban contracts (danfo-contracts repo)
                    danfo-registry: submit (staked) → attest → finalize
                    danfo-rewards:  sponsor pool → claim per accepted correction
```

## The one rule

**Reads may go through the indexer. Writes never do.**

Every state-changing transaction is signed in the browser by
[Freighter](https://www.freighter.app/) and submitted to Soroban RPC. The
indexer holds no user keys and cannot move user funds; the worst a compromised
indexer can do is serve a stale or wrong *feed*, which any client can
independently verify by reading the chain. The web app does exactly that when
the indexer is unreachable.

## Components

| Workspace | Runtime | Responsibility |
|---|---|---|
| [`apps/web`](../developers/web-app.md) | Next.js 14 (App Router) | Multilingual chat, voice, route map, corrections feed, wallet, fare payments |
| [`packages/sdk`](../developers/sdk.md) | TypeScript library | `@danfo/sdk` — typed clients for both contracts: reads via simulation, XDR builders for writes |
| [`indexer/`](../developers/indexer.md) | Node + SQLite | Mirrors chain state, serves the REST feed, cranks finalize/claim |
| [`services/speech`](../developers/speech.md) | Python / FastAPI | Optional YarnGPT2 TTS + Whisper STT for Nigerian languages |
| [danfo-contracts](https://github.com/OGRoute/danfo-contracts) | Soroban / Rust | `danfo-registry`, `danfo-rewards` |

The SDK is the seam. The web app and the indexer both talk to chain exclusively
through it, so contract-shape changes land in one place.

## Why state-polling, not events

The indexer does not tail contract events or maintain a cursor. It reads
`total()`, walks any ids it has not seen, and re-reads the ones still marked
`Pending`. All the state it needs lives in the `Correction` struct itself.

That makes the indexer **self-healing**: after arbitrary downtime it converges on
the correct state with no replay logic and no cursor to corrupt. The cost is a
handful of simulation reads per poll — cheap, since simulations are free.

## Degradation

Each dependency fails soft, by design:

| If this is down | What happens |
|---|---|
| Indexer | Feed reads fall back to direct chain simulation (`source: "chain"`) |
| Crank | Corrections stay pending; anyone can call `finalize` / `claim` themselves |
| Speech service | Chat still works in text; voice controls hide |
| Inference endpoint | Corrections feed and map still work |
| Reward pool empty | `claim` reverts, correction stays accepted and claimable later |

CI enforces part of this: the web build must succeed with **no secrets set**, so
a missing key degrades a feature rather than breaking the app.
