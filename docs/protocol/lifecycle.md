---
description: How a correction travels from submission to reward.
---

# Lifecycle

A correction is a claim about the transit network — a fare has changed, a route
now diverts, a stop is closed. Every one of them moves through four states, all
enforced on-chain by [`danfo-registry`](../contracts/registry.md).

```
submit (staked)  ──►  attest (challenge window)  ──►  finalize  ──┬──► Accepted ──► claim
                                                                  └──► Rejected (slashed)
```

## 1. Submit

A contributor calls `submit` with a route slug (`cms-oshodi`), a kind
(`Fare` / `Route` / `Closure`), a short human-readable summary, and the sha256
hash of the full off-chain JSON payload. The contract transfers `stake_amount`
from the contributor to itself and records the correction as **Pending** with
`finalize_after = now + challenge_window`.

The stake is the anti-spam mechanism: making a false claim is not free, and
making many is expensive.

> Only the 32-byte payload hash goes on-chain. The full payload lives off-chain,
> and the hash is what lets any consumer prove the data they hold is the data
> that was staked on.

## 2. Attest

During the challenge window, peers call `attest(id, approve)`. The contract
enforces the rules that make attestation meaningful:

* **One vote per address per correction** — `AlreadyVoted` otherwise.
* **No self-voting** — the contributor cannot attest their own correction
  (`SelfVote`).
* **Pending only** — a finalized correction cannot be re-litigated
  (`NotPending`).

Approvals and rejections are counted on the correction itself, so the current
tally is a public read at any time.

## 3. Finalize

Once `finalize_after` has passed, **anyone** can call `finalize(id)` — it takes
no auth, and the caller only pays the fee. In practice the
[indexer's crank](../developers/indexer.md#the-crank) does it on a timer, but the
protocol does not depend on that: if the crank is down, any user can settle any
correction.

The outcome is deterministic:

```
accepted  iff  (approvals + rejections) >= min_votes  AND  approvals > rejections
```

* **Accepted** → stake refunded to the contributor, their `AcceptedCount`
  (reputation) increments.
* **Rejected** → stake transferred to `slash_recipient`, which is set to the
  rewards contract after deploy — so spam funds the honest contributors.

A correction below `min_votes` is rejected, not left pending: unnoticed claims
do not silently enter the knowledge base.

## 4. Claim

Accepted corrections are eligible for a fixed reward from
[`danfo-rewards`](../contracts/rewards.md). `claim(id)` is permissionless and
idempotent — it reads the correction from the registry cross-contract, checks it
is `Accepted` and not already `Claimed`, and pays `reward_amount` to the
**recorded contributor**, never to the caller. Anyone can crank a claim on
someone else's behalf and gains nothing but the fee bill.

## Reputation

The registry tracks `(submitted, accepted)` per address, readable via
`reputation(who)`. It is not used for weighting today — it is the raw material
for future reputation-weighted attestation, and it is already visible in the
app's contributor view.

## Reading the state

Everything above is readable without a wallet:

* Directly from chain via [`@danfo/sdk`](../developers/sdk.md) simulation.
* From the [indexer REST API](../developers/indexer.md), which mirrors chain
  state into SQLite for fast feeds.

The web app prefers the indexer and falls back to chain reads when it is
unavailable, so the feed degrades in latency rather than availability.
