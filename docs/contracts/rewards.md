---
description: The sponsor-funded pool paying a fixed reward per accepted correction.
---

# danfo-rewards

Source: [danfo-contracts](https://github.com/OGRoute/danfo-contracts). Single
responsibility: hold sponsor funds and pay a fixed reward per accepted
correction. Claim-based (pull, not push) and idempotent per correction id.

It makes a cross-contract read of the registry, so it is deployed **second**.

## Types

```rust
pub struct RewardsConfig {
    pub admin: Address,
    pub token: Address,      // must match the registry's token
    pub registry: Address,   // danfo-registry contract id
    pub reward_amount: i128, // per accepted correction
}
```

Storage: `Config` (instance); `Claimed(u32)` → `bool` and `TotalPaid` → `i128`
(persistent).

## Functions

| Function | Signature | Auth | Notes |
|---|---|---|---|
| `init` | `init(config: RewardsConfig)` | one-shot, none | `AlreadyInitialized` guard |
| `fund` | `fund(sponsor, amount: i128)` | `sponsor` | Transfers `amount` into the pool |
| `claim` | `claim(id: u32)` | none — anyone | Pays the **recorded contributor**, not the caller |
| `set_reward` | `set_reward(amount: i128)` | `admin` | Retunes the payout |
| `pool()` | `-> i128` | none | `token.balance(contract)` |
| `is_claimed(id)` | `-> bool` | none | |
| `total_paid()` | `-> i128` | none | Lifetime payouts |

### claim

```
registry.get(id).status == Accepted   else NotAccepted
Claimed(id) unset                     else AlreadyClaimed
pool() >= reward_amount               else InsufficientPool
→ transfer reward_amount to correction.contributor
→ set Claimed(id), add to TotalPaid
```

The cross-contract call uses the registry's generated client
(`registry::Client::new(&env, &config.registry).get(&id)`), imported via
`contractimport!` of the registry wasm — so the rewards contract cannot be
tricked into paying on a correction the registry never accepted.

Because `claim` takes no auth and pays a recorded address, it is safe to crank:
the caller spends a fee and receives nothing. That is exactly what the
[indexer crank](../developers/indexer.md#the-crank) does, and why users are never
stranded when it is offline — they can call `claim` themselves.

## Errors

| Code | Error |
|---|---|
| 1 | `NotInitialized` |
| 2 | `AlreadyInitialized` |
| 3 | `NotAccepted` |
| 4 | `AlreadyClaimed` |
| 5 | `InsufficientPool` |
| 6 | `NotAdmin` |

`InsufficientPool` is a *retryable* failure, not a lost reward: the correction
stays accepted and unclaimed, and the next crank pass pays it once a sponsor
refills the pool.

## Events

| Topics | Data |
|---|---|
| `("init",)` | `(admin)` |
| `("fund", sponsor)` | `(amount)` |
| `("claim",)` | `(id, contributor, amount)` |
| `("config",)` | `(amount)` |

## Calling it

```ts
import { RewardsClient } from "@danfo/sdk";

const rewards = new RewardsClient(cfg);      // requires cfg.rewardsId

await rewards.pool();                        // bigint, base units
await rewards.totalPaid();
await rewards.isClaimed(id);

const fundXdr  = await rewards.buildFundXdr(sponsor, 1_000_0000000n);
const claimXdr = await rewards.buildClaimXdr(source, id);
```
