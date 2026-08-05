---
description: Every environment variable, its default, and what breaks without it.
---

# Environment variables

Canonical template: [`apps/web/.env.example`](https://github.com/OGRoute/Danfo-AI/blob/main/apps/web/.env.example).
Copy it to `apps/web/.env.local` for local development; in production use the
hosting provider's env UI.

> Anything prefixed `NEXT_PUBLIC_` is compiled into the browser bundle. Never put
> a secret behind that prefix. `STELLAR_SECRET`, `INFERENCE_API_KEY`, and
> `INDEXER_SECRET_KEY` are server-side only — CI runs a gitleaks scan to catch
> them being committed.

## Web app (`apps/web`)

### Stellar

| Var | Default | Purpose |
|---|---|---|
| `STELLAR_RPC_URL` | testnet Soroban RPC | Soroban RPC endpoint |
| `STELLAR_HORIZON_URL` | testnet Horizon | Horizon endpoint for classic operations |
| `NEXT_PUBLIC_REGISTRY_CONTRACT` | — | `danfo-registry` id. Unset ⇒ corrections panel reports "not configured" |
| `NEXT_PUBLIC_REWARDS_CONTRACT` | — | `danfo-rewards` id. Unset ⇒ pool stats and claims unavailable |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` | Network passphrase selection |
| `STELLAR_PUBLIC_KEY` | — | Source account for read simulations |
| `STELLAR_SECRET` | — | **Server-side key.** Powers the wallet-less fallback path where the app stakes and signs on the user's behalf. Leave unset to require Freighter for all writes |

### Inference

| Var | Purpose |
|---|---|
| `INFERENCE_BASE_URL` | Any OpenAI-compatible endpoint |
| `INFERENCE_API_KEY` | Key for that endpoint |
| `INFERENCE_MODEL` | Model id to request |

Unset ⇒ chat answers fail; the corrections feed and map keep working.

### Speech

| Var | Purpose |
|---|---|
| `YARNGPT_API_URL` | Base URL of the [speech service](speech.md), e.g. `http://localhost:8000`. Unset ⇒ voice output unavailable |

## Indexer (`indexer/`)

| Var | Default | Purpose |
|---|---|---|
| `REGISTRY_CONTRACT` | — | **Required.** Startup throws without it |
| `REWARDS_CONTRACT` | `""` | Unset ⇒ `/stats` reports zero pool, claim cranking disabled |
| `INDEXER_SECRET_KEY` | `""` | Crank account secret. **Unset ⇒ the finalize/claim crank is disabled** and the indexer runs read-only |
| `READ_SOURCE_ACCOUNT` | — | Required *only* when `INDEXER_SECRET_KEY` is unset — supplies the simulation source account |
| `INDEXER_PORT` | `8787` | REST API port |
| `INDEXER_DB_PATH` | `./danfo.db` | SQLite file |
| `INDEXER_POLL_MS` | `10000` | Chain-state poll interval |
| `INDEXER_CRANK_MS` | `60000` | Finalize/claim crank interval |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Network passphrase |

The crank account needs XLM to pay fees. It **cannot** route funds to itself —
`finalize` refunds the recorded contributor and `claim` pays the recorded
contributor — so the exposure of the crank key is bounded by its own balance.

## Speech service (`services/speech`)

| Var | Default | Purpose |
|---|---|---|
| `YARNGPT_MODEL` | `saheedniyi/YarnGPT2` | Hugging Face model id |
| `WAV_TOKENIZER_CONFIG` | `models/...attn.yaml` | WavTokenizer config path |
| `WAV_TOKENIZER_MODEL` | `models/...24k.ckpt` | WavTokenizer checkpoint path |

## Minimal configurations

**Just look at the UI:** nothing. `npm install && npm run dev`.

**Full on-chain flow with Freighter:**

```bash
NEXT_PUBLIC_REGISTRY_CONTRACT=C...
NEXT_PUBLIC_REWARDS_CONTRACT=C...
NEXT_PUBLIC_STELLAR_NETWORK=testnet
STELLAR_PUBLIC_KEY=G...
```

**Indexer with an active crank:**

```bash
REGISTRY_CONTRACT=C...
REWARDS_CONTRACT=C...
INDEXER_SECRET_KEY=S...
```
