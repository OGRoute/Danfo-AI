---
description: Deploy order, init parameters, and wiring the ids into the app.
---

# Deployment

Order matters: **registry first, rewards second, then a registry `set_config`**.
The rewards contract needs the registry's id at init, and the registry's
`slash_recipient` should point at the rewards contract — which does not exist
until step 3.

## Testnet

```bash
# 1. Build both wasms
stellar contract build            # in the danfo-contracts workspace

# 2. Deploy + init the registry
#    token = XLM SAC:  stellar contract id asset --asset native
#    stake_amount     = 10_0000000   (10 XLM)
#    challenge_window = 86400        (24 h)
#    min_votes        = 2
#    slash_recipient  = admin        (temporary — fixed in step 4)

# 3. Deploy + init rewards
#    token         = same SAC as the registry
#    registry      = id from step 2
#    reward_amount = 5_0000000       (5 XLM)

# 4. Point slashed stakes at the reward pool
#    registry set_config { ..., slash_recipient = <rewards id> }
```

`danfo-contracts/scripts/deploy.sh` runs all four steps and prints both contract
ids in a copy-pasteable block. See that repo for the authoritative script and
current flag names.

> The token address must be **identical** in both contracts. A mismatch is not
> caught at init and shows up later as claims that transfer the wrong asset.

## Verify

```bash
stellar contract invoke --id <REGISTRY_ID> -- total          # → 0
stellar contract invoke --id <REWARDS_ID>  -- pool           # → 0
stellar contract invoke --id <REWARDS_ID>  -- total_paid     # → 0
```

Then fund the pool — an empty pool means every `claim` reverts with
`InsufficientPool`. See [For sponsors](../guides/sponsors.md).

## Wire the ids into the app

Both contract ids go into the web app env (locally `apps/web/.env.local`, in
production the hosting provider's env UI) and the indexer env:

```bash
# apps/web
NEXT_PUBLIC_REGISTRY_CONTRACT=C...
NEXT_PUBLIC_REWARDS_CONTRACT=C...
NEXT_PUBLIC_STELLAR_NETWORK=testnet

# indexer
REGISTRY_CONTRACT=C...
REWARDS_CONTRACT=C...
```

Full list: [Environment variables](../developers/environment.md).

## Hosting topology

| Component | Target | Notes |
|---|---|---|
| `apps/web` | Vercel | Next.js App Router, Node runtime for the API routes |
| `indexer` | Render (Node) | Root dir `indexer/`, build `npm ci && npm run build -w indexer`, start `npm run start -w indexer` |
| Indexer DB | SQLite on a persistent disk | Or Postgres if moving off SQLite |

Read path: user → web → indexer → db. Write path: browser → Freighter → Soroban
RPC. The indexer is never in the write path — see
[Architecture](../protocol/architecture.md#the-one-rule).

## Mainnet notes

Nothing here is mainnet-ready yet: the contracts are **unaudited**. When that
changes, the differences are the token (NGNC SAC instead of the native XLM SAC),
a re-tune of `stake_amount` / `reward_amount` against a live NGN rate
([Economics](../protocol/economics.md)), and a crank account funded for sustained
fee spend.
