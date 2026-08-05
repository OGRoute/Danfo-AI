---
description: The correction lifecycle contract — submit, attest, finalize.
---

# danfo-registry

Source: [danfo-contracts](https://github.com/OGRoute/danfo-contracts). Single
responsibility: the lifecycle of a correction. It has no dependency on the
rewards contract and is deployed first.

## Types

```rust
pub enum Kind   { Fare = 0, Route = 1, Closure = 2 }
pub enum Status { Pending = 0, Accepted = 1, Rejected = 2 }

pub struct Correction {
    pub contributor: Address,
    pub route_id: String,         // slug, e.g. "cms-oshodi"
    pub kind: Kind,
    pub payload_hash: BytesN<32>, // sha256 of the off-chain JSON payload
    pub summary: String,          // short human-readable, ≤ 200 chars (enforced off-chain)
    pub stake: i128,
    pub status: Status,
    pub submitted_at: u64,
    pub finalize_after: u64,      // submitted_at + challenge_window
    pub approvals: u32,
    pub rejections: u32,
}

pub struct Config {
    pub admin: Address,
    pub token: Address,           // SAC used for stakes
    pub stake_amount: i128,
    pub challenge_window: u64,    // seconds
    pub min_votes: u32,
    pub slash_recipient: Address, // set to the rewards contract after deploy
}
```

## Storage

`Config` lives in instance storage. Everything else is persistent, with
`extend_ttl` called on every write:

| Key | Value |
|---|---|
| `Count` | `u32` — total corrections ever submitted |
| `Correction(u32)` | the struct above |
| `Voted(u32, Address)` | `bool` — one vote per address per correction |
| `SubmittedCount(Address)` | `u32` |
| `AcceptedCount(Address)` | `u32` — reputation |

## Functions

### Writes

| Function | Signature | Auth |
|---|---|---|
| `init` | `init(config: Config)` | one-shot, none |
| `submit` | `submit(contributor, route_id, kind, payload_hash, summary) -> u32` | `contributor` |
| `attest` | `attest(voter, id: u32, approve: bool)` | `voter` |
| `finalize` | `finalize(id: u32) -> Status` | none — anyone |
| `set_config` | `set_config(config: Config)` | existing `admin` |

**`submit`** transfers `stake_amount` from the contributor to the contract,
stores the correction as `Pending` with
`finalize_after = now + challenge_window`, increments `Count` and the
contributor's `SubmittedCount`, and returns the new id.

**`attest`** rejects `BadId`, `NotPending`, `SelfVote` (voter == contributor),
and `AlreadyVoted`, then increments `approvals` or `rejections`.

**`finalize`** requires `now >= finalize_after` (`WindowNotElapsed`). Accepts
iff `approvals + rejections >= min_votes && approvals > rejections`. On accept
the stake returns to the contributor and `AcceptedCount` increments; on reject
the stake goes to `slash_recipient`.

**`set_config`** replaces the whole config — its main use is pointing
`slash_recipient` at the rewards contract once that contract exists.

### Reads

| Function | Returns |
|---|---|
| `get(id: u32)` | `Correction` — `BadId` if unknown |
| `total()` | `u32` — `Count`, or 0 |
| `recent(n: u32)` | `Vec<Correction>`, newest first, capped at `Count` |
| `reputation(who: Address)` | `(submitted, accepted)` |

## Errors

| Code | Error | Raised by |
|---|---|---|
| 1 | `NotInitialized` | any function before `init` |
| 2 | `AlreadyInitialized` | second `init` |
| 3 | `BadId` | `get`, `attest`, `finalize` |
| 4 | `AlreadyVoted` | `attest` |
| 5 | `NotPending` | `attest`, `finalize` |
| 6 | `SelfVote` | `attest` |
| 7 | `WindowNotElapsed` | `finalize` |
| 8 | `NotAdmin` | `set_config` |

## Events

| Topics | Data |
|---|---|
| `("init",)` | `(admin)` |
| `("submit", contributor)` | `(id, route_id, kind)` |
| `("attest", voter)` | `(id, approve)` |
| `("final",)` | `(id, status)` |
| `("config",)` | `(admin)` |

## Calling it

From TypeScript, use [`@danfo/sdk`](../developers/sdk.md) rather than hand-rolling
ScVals:

```ts
import { RegistryClient, CorrectionKind } from "@danfo/sdk";

const registry = new RegistryClient(cfg);

const feed = await registry.recent(20);          // read, no wallet needed
const xdr  = await registry.buildSubmitXdr({     // write, sign with Freighter
  contributor,
  routeId: "cms-oshodi",
  kind: CorrectionKind.Fare,
  payloadHash,                                   // 32 bytes, enforced
  summary: "CMS→Oshodi now ₦1,200 in morning peak",
});
```
