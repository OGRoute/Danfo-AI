---
description: Fund the reward pool that pays contributors for verified transit data.
---

# For sponsors

The reward pool is what turns "someone should map Lagos transit" into paid work.
Sponsors fund it; the protocol spends it only on corrections that survived peer
attestation.

## What your funding buys

Every accepted correction pays `reward_amount` (5 XLM by default) to the person
who submitted it. Nothing pays out for a correction that was rejected — that
stake flows *into* the pool instead. So a sponsor is buying verified transit
facts at a known unit price, not paying for submissions.

At launch defaults and rates as of 5 August 2026, one accepted correction costs
the pool ≈ **₦1,140**. See [Economics](../protocol/economics.md) for the full
arithmetic and current-rate caveats.

## How to fund

```ts
import { RewardsClient } from "@danfo/sdk";

const rewards = new RewardsClient(cfg);
const xdr = await rewards.buildFundXdr(sponsorAddress, 1_000_0000000n); // 1,000 XLM
// sign with Freighter → submit
```

Or invoke `fund` directly:

```bash
stellar contract invoke --id <REWARDS_ID> --source <SPONSOR> -- \
  fund --sponsor <SPONSOR_ADDRESS> --amount 1000_0000000
```

Amounts are `i128` base units — stroops for XLM (1 XLM = 10,000,000).

## What you can verify

Everything, without asking anyone:

| Read | Tells you |
|---|---|
| `pool()` | Current balance — how many more rewards are payable |
| `total_paid()` | Lifetime payouts |
| `is_claimed(id)` | Whether a specific correction has been paid |
| `total()` / `recent(n)` on the registry | What the pool actually bought |
| indexer `GET /stats` | All of the above in one JSON response |

There is no admin withdrawal path. Funds in the pool leave only via `claim`, and
`claim` only ever pays the contributor recorded on an **accepted** correction.
The admin can retune `reward_amount` via `set_reward`, which changes the unit
price of future claims but cannot redirect funds.

## Pool health

If the pool cannot cover a reward, `claim` reverts with `InsufficientPool`. The
correction stays accepted and unclaimed and pays out the moment you refill —
nothing is lost, but contributors are left waiting, which is the fastest way to
lose them. Watch `pool()` against the recent acceptance rate and keep a buffer.

The pool also tops itself up: every rejected correction's stake (10 XLM by
default) is slashed into it. Spam subsidises honest contributors.

## Getting in touch

Open an issue on [Danfo-AI](https://github.com/OGRoute/Danfo-AI/issues) or reach
the maintainers via the contacts in
[SECURITY.md](https://github.com/OGRoute/Danfo-AI/blob/main/SECURITY.md).
