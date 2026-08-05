---
description: Launch parameters, worked numbers, and where the money comes from.
---

# Economics

Danfo has one scarce resource — attention on whether a claim about a route is
true — and it prices it. Everything below is denominated in a Stellar Asset
Contract (SAC) chosen at init: the native XLM SAC on testnet, with NGNC
(Stellar's naira stablecoin) as a mainnet option. All amounts are `i128` in base
units (stroops for XLM: 1 XLM = 10,000,000 stroops). There are no floats
anywhere in the system.

## Launch parameters

| Parameter | Contract | Default | Meaning |
|---|---|---|---|
| `stake_amount` | registry | 10 XLM (`10_0000000`) | Locked at submission |
| `challenge_window` | registry | 86,400 s (24 h) | Attestation period before finalize |
| `min_votes` | registry | 2 | Total attestations required to accept |
| `slash_recipient` | registry | rewards contract | Where rejected stakes go |
| `reward_amount` | rewards | 5 XLM (`5_0000000`) | Paid per accepted correction |

All five are admin-tunable after deploy — `set_config` on the registry,
`set_reward` on the rewards contract. See
[Deployment](../contracts/deployment.md) for the sequencing that points
`slash_recipient` at the rewards pool.

## Worked numbers

Rates as of **5 August 2026**: XLM ≈ **$0.167**
([CoinMarketCap](https://coinmarketcap.com/currencies/stellar/)); USD/NGN ≈
**₦1,364** (CBN official rate, [nairaCompare](https://nairacompare.ng/exchange-rates)).
That puts 1 XLM ≈ **₦228**.

| Event | Contributor | Reward pool |
|---|---|---|
| Submit | −10 XLM (≈ ₦2,280) locked | — |
| Accepted | +10 XLM stake refunded, +5 XLM reward (≈ ₦1,140) | −5 XLM |
| Rejected | −10 XLM (stake slashed) | +10 XLM |

**Net position on an accepted correction: +5 XLM ≈ ₦1,140. On a rejected one:
−10 XLM ≈ −₦2,280.**

> Prices move. Recompute these figures against a cited live rate before quoting
> them anywhere that matters, and re-tune `stake_amount` / `reward_amount` if
> the fiat-denominated stake drifts away from "meaningful but affordable" for a
> Lagos rider.

## Why the numbers are shaped this way

**Stake > reward (10 vs 5).** A spammer who guesses wrong loses twice what an
honest contributor earns for being right. Randomly submitting claims and hoping
attestors are asleep is negative-EV unless you can pass attestation more than
two-thirds of the time — which requires being right.

**Rejected stakes fund rewards.** `slash_recipient` is the rewards contract, so
spam is not burned, it is redistributed to the people who did the work of
catching it. A sustained spam attack subsidises the honest side of the network.

**Sponsors top up the rest.** The pool is not self-financing at steady state:
every accepted correction pays out 5 XLM with nothing coming in from that path.
`fund(sponsor, amount)` is how transit operators, civic funders, or the project
treasury keep it solvent. `pool()` and `total_paid()` are public reads — pool
health is auditable at any time, and the app surfaces it in the corrections
feed. See [For sponsors](../guides/sponsors.md).

**Claims fail closed.** If the pool cannot cover `reward_amount`, `claim`
reverts with `InsufficientPool`. The correction stays accepted and unclaimed,
and the reward becomes payable the moment the pool is refilled — nothing is
lost, and the crank retries automatically.

## Cash out

With NGNC as the token and a SEP-24 anchor, a claimed reward can leave the
protocol as naira in a Nigerian bank account, without the contributor ever
handling a volatile asset. On testnet the flow runs on XLM.

## Cost to participate

Beyond the stake, participants pay ordinary Soroban fees (fractions of a cent
per transaction). Two roles pay fees without earning:

* **Attestors** pay a fee to vote and are not compensated today. Attestation is
  currently altruistic-plus-reputation; paying attestors out of the slash pool
  is the obvious next iteration.
* **The crank** pays every `finalize` and `claim` fee. It can never route funds
  to itself — the contracts only ever pay recorded addresses — so running one is
  a pure cost, and anyone may run one.
