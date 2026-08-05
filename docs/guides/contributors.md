---
description: Stake on a correction, attest to other people's, get paid for being right.
---

# For contributors

You ride these routes. You know when a fare has changed or a road has closed
before any dataset does. Danfo pays you for writing that down — and charges you
for writing down something false.

## What you need

* [Freighter](https://www.freighter.app/) installed in your browser.
* A funded **testnet** account — [friendbot](https://friendbot.stellar.org) will
  fund one for free.
* Enough balance to cover the stake (10 XLM by default) plus fees.

## Submit a correction

1. Open the ⭐ corrections panel and connect Freighter.
2. Pick the **route** (e.g. `cms-oshodi`) and the **kind**:

   | Kind | Use it for |
   |---|---|
   | `Fare` | The price has changed |
   | `Route` | The path, stops, or transfer point has changed |
   | `Closure` | A road or stop is out of service |

3. Write a **short, checkable summary** — one sentence someone else can verify
   from their own experience. "CMS→Oshodi is now ₦1,200 in morning peak" is
   checkable. "Fares went up" is not.
4. Sign. Your stake is locked and the correction enters a **24-hour challenge
   window**.

## Attest to others

Open the feed, read the pending corrections, and vote **approve** or **reject**
on ones you can actually judge. Rules the contract enforces:

* One vote per correction per address.
* You cannot vote on your own correction.
* Voting closes when the window elapses.

Voting is not rewarded today — it costs you a small fee and builds the shared
knowledge base. It is the part of the system most in need of more people.

## What happens at the end of the window

Anyone can call `finalize` once 24 hours have passed (the indexer's crank does
it automatically). The outcome:

| Result | Condition | You get |
|---|---|---|
| **Accepted** | at least 2 total votes **and** more approvals than rejections | Stake back + 5 XLM reward |
| **Rejected** | too few votes, or rejections ≥ approvals | Stake slashed into the reward pool |

Note that **too few votes means rejection**, not "pending forever". A correction
nobody looked at does not enter the knowledge base.

## Getting paid

Rewards are **claim-based**. The crank claims for you automatically, but if it is
down you never need to wait on it: `claim(id)` is permissionless and always pays
the recorded contributor, so anyone — including you — can trigger your payout.

If you see the claim not going through, the usual cause is an empty reward pool
(`InsufficientPool`). Nothing is lost; the reward becomes payable as soon as a
sponsor refills it.

## Reputation

The registry tracks your `(submitted, accepted)` counts on-chain, readable by
anyone via `reputation(address)` or the indexer's `/contributors/:address`. It
does not affect payouts today — it is the foundation for reputation-weighted
attestation later, and it is a public track record now.

## Getting accepted more often

* **Be specific.** Name the route, the direction, and the time of day.
* **Correct one thing per submission.** Bundled claims are hard to vote on, and
  a voter who disagrees with any part rejects the whole thing.
* **Submit what you saw, not what you heard.** Attestors are riders too.
* **Do not resubmit a rejected correction unchanged.** You will lose the stake
  twice.

## Risks

The contracts are unaudited testnet software. Your stake is genuinely at risk —
from being wrong, from attestors being wrong, and from bugs. Do not stake value
you cannot lose.
