# Phase 5 — Contract Architecture Specification

Two contracts. Build and deploy order: **registry first, rewards second**
(rewards makes a cross-contract read of registry; registry has no dependency
on rewards).

Token: any Stellar Asset Contract (SAC) address supplied at init — XLM SAC on
testnet, NGNC SAC as a mainnet option. All amounts `i128` in stroops/base
units. No floats anywhere.

---

## Contract 1: `danfo-registry`

Single responsibility: the lifecycle of a correction —
`submit (staked) → attest (challenge window) → finalize (accept/refund | reject/slash)`.

### Storage

```rust
#[contracttype]
#[derive(Clone, Copy, PartialEq)]
pub enum Kind { Fare = 0, Route = 1, Closure = 2 }

#[contracttype]
#[derive(Clone, Copy, PartialEq)]
pub enum Status { Pending = 0, Accepted = 1, Rejected = 2 }

#[contracttype]
#[derive(Clone)]
pub struct Correction {
    pub contributor: Address,
    pub route_id: String,        // slug, e.g. "cms-oshodi"
    pub kind: Kind,
    pub payload_hash: BytesN<32>, // sha256 of the off-chain JSON payload
    pub summary: String,          // short human-readable, ≤ 200 chars enforced off-chain
    pub stake: i128,
    pub status: Status,
    pub submitted_at: u64,
    pub finalize_after: u64,      // submitted_at + challenge_window
    pub approvals: u32,
    pub rejections: u32,
}

#[contracttype]
pub struct Config {
    pub admin: Address,
    pub token: Address,           // SAC used for stakes
    pub stake_amount: i128,
    pub challenge_window: u64,    // seconds
    pub min_votes: u32,           // min total attestations to accept
    pub slash_recipient: Address, // where rejected stakes go (set to rewards pool after deploy)
}

#[contracttype]
pub enum DataKey {
    Config,                      // instance storage
    Count,                       // u32, persistent
    Correction(u32),             // persistent
    Voted(u32, Address),         // persistent, bool
    AcceptedCount(Address),      // persistent, u32 — reputation
    SubmittedCount(Address),     // persistent, u32
}
```

Instance storage: `Config`. Persistent storage: everything else, with TTL
extension (`extend_ttl`) on every write.

### Errors

```rust
#[contracterror]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    BadId = 3,
    AlreadyVoted = 4,
    NotPending = 5,
    SelfVote = 6,
    WindowNotElapsed = 7,
    NotAdmin = 8,
}
```

### Functions

| Function | Signature | Auth | Behavior | Events |
|---|---|---|---|---|
| `init` | `init(env, config: Config)` | none (one-shot) | Errors `AlreadyInitialized` if Config exists. Stores config. | `("init",) (admin)` |
| `submit` | `submit(env, contributor: Address, route_id: String, kind: Kind, payload_hash: BytesN<32>, summary: String) -> u32` | `contributor.require_auth()` | `token.transfer(contributor, contract, stake_amount)`; store Correction (Pending, `finalize_after = now + challenge_window`); increment Count and SubmittedCount. Returns id. | `("submit", contributor) (id, route_id, kind)` |
| `attest` | `attest(env, voter: Address, id: u32, approve: bool)` | `voter.require_auth()` | Errors: `BadId`, `NotPending`, `SelfVote` (voter == contributor), `AlreadyVoted`. Records vote, increments approvals or rejections. | `("attest", voter) (id, approve)` |
| `finalize` | `finalize(env, id: u32) -> Status` | none (anyone) | Errors: `BadId`, `NotPending`, `WindowNotElapsed` (now < finalize_after). Accept iff `approvals + rejections >= min_votes && approvals > rejections`; else Reject. Accept → `token.transfer(contract, contributor, stake)`, increment AcceptedCount. Reject → `token.transfer(contract, slash_recipient, stake)`. Set status. | `("final", ) (id, status)` |
| `get` | `get(env, id: u32) -> Correction` | none | Errors `BadId`. | — |
| `total` | `total(env) -> u32` | none | Count or 0. | — |
| `recent` | `recent(env, n: u32) -> Vec<Correction>` | none | Newest first, capped at Count. | — |
| `reputation` | `reputation(env, who: Address) -> (u32, u32)` | none | `(submitted, accepted)`. | — |
| `set_config` | `set_config(env, config: Config)` | `existing.admin.require_auth()` | Replaces config (used to point `slash_recipient` at rewards after its deploy). | `("config",) (admin)` |

Every function maps to a user flow step: submit (contributor in the app's
corrections panel), attest (community feed), finalize (anyone — the indexer
cron calls it), reads (feed + AI grounding), set_config (deploy sequencing).
No speculative functions.

---

## Contract 2: `danfo-rewards`

Single responsibility: sponsor-funded pool paying a fixed reward per accepted
correction, claim-based (pull), idempotent per correction id.

### Storage

```rust
#[contracttype]
pub struct RewardsConfig {
    pub admin: Address,
    pub token: Address,          // must match registry's token
    pub registry: Address,       // danfo-registry contract id
    pub reward_amount: i128,     // per accepted correction
}

#[contracttype]
pub enum DataKey {
    Config,          // instance
    Claimed(u32),    // persistent, bool — correction id already paid
    TotalPaid,       // persistent, i128
}
```

### Errors

```rust
#[contracterror]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAccepted = 3,
    AlreadyClaimed = 4,
    InsufficientPool = 5,
    NotAdmin = 6,
}
```

### Functions

| Function | Signature | Auth | Behavior | Events |
|---|---|---|---|---|
| `init` | `init(env, config: RewardsConfig)` | none (one-shot) | `AlreadyInitialized` guard. | `("init",) (admin)` |
| `fund` | `fund(env, sponsor: Address, amount: i128)` | `sponsor.require_auth()` | `token.transfer(sponsor, contract, amount)`. | `("fund", sponsor) (amount)` |
| `claim` | `claim(env, id: u32)` | none (anyone; pays the recorded contributor, not the caller) | Cross-contract `registry.get(id)` → must be `Accepted` else `NotAccepted`; `Claimed(id)` must be unset else `AlreadyClaimed`; pool balance ≥ reward_amount else `InsufficientPool`. Transfer `reward_amount` to `correction.contributor`, set Claimed, add to TotalPaid. | `("claim",) (id, contributor, amount)` |
| `pool` | `pool(env) -> i128` | none | `token.balance(contract)`. | — |
| `is_claimed` | `is_claimed(env, id: u32) -> bool` | none | | — |
| `total_paid` | `total_paid(env) -> i128` | none | | — |
| `set_reward` | `set_reward(env, amount: i128)` | `admin.require_auth()` | | `("config",) (amount)` |

Cross-contract call uses the registry's generated client
(`registry::Client::new(&env, &config.registry).get(&id)`), imported via
`contractimport!` of the registry wasm.

---

## Deploy sequence (testnet)

1. Build both wasms (`stellar contract build` in workspace).
2. Deploy **registry**; `init` with token = XLM SAC
   (`stellar contract id asset --asset native`), `stake_amount` = 10 XLM
   (10_0000000), `challenge_window` = 86400, `min_votes` = 2,
   `slash_recipient` = admin (temporary).
3. Deploy **rewards**; `init` with same token, `registry` = step-2 id,
   `reward_amount` = 5 XLM (5_0000000).
4. Registry `set_config` updating `slash_recipient` → rewards contract id
   (slashed spam tops up the reward pool).
5. Print both contract ids in a copy-pasteable block.

Parameter values above are launch defaults, tunable by admin; document them
with worked numbers in the docs site (e.g. a 10 XLM stake ≈ ₦-equivalent
figure at current price — compute at doc-writing time, cite the rate).
