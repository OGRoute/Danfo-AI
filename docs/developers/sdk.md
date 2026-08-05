---
description: "@danfo/sdk — typed clients for the registry and rewards contracts."
---

# @danfo/sdk

`packages/sdk` is the single seam between TypeScript and the Soroban contracts.
The web app and the indexer both go through it, so a contract-shape change lands
in one place.

It is a workspace package (`"main": "src/index.ts"`, consumed as TypeScript
source — no build step) with `@stellar/stellar-sdk` ^16 as a peer dependency.

## The model

**Reads** are simulations: build → simulate → decode. They are never submitted,
cost nothing, and need no wallet — only a funded account id to simulate *from*
(`readSource`).

**Writes** are never signed by the SDK. Each `build*Xdr` method returns a
prepared (simulated, footprint-set) unsigned XDR for the caller to sign — with
Freighter in the browser, or a `Keypair` server-side via `signAndSend`. The SDK
holds no keys.

## Configuration

```ts
import type { DanfoConfig } from "@danfo/sdk";

const cfg: DanfoConfig = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  registryId: "C...",
  rewardsId: "C...",        // optional; RewardsClient throws without it
  readSource: "G...",       // funded account used as the simulation source
};
```

## RegistryClient

```ts
import { RegistryClient, CorrectionKind } from "@danfo/sdk";
const registry = new RegistryClient(cfg);
```

| Method | Returns |
|---|---|
| `total()` | `Promise<number>` |
| `get(id)` | `Promise<Correction>` |
| `recent(n = 10)` | `Promise<Correction[]>` — newest first, **ids attached** |
| `reputation(who)` | `Promise<{ submitted, accepted }>` |
| `buildSubmitXdr({ contributor, routeId, kind, payloadHash, summary })` | `Promise<string>` |
| `buildAttestXdr({ voter, id, approve })` | `Promise<string>` |
| `buildFinalizeXdr(source, id)` | `Promise<string>` |

`recent()` derives ids from `total()` (the contract returns bare structs), so a
correction from `recent()` can be acted on directly.

`buildFinalizeXdr` takes a `source` that only pays the fee — `finalize` requires
no auth on-chain.

## RewardsClient

```ts
import { RewardsClient } from "@danfo/sdk";
const rewards = new RewardsClient(cfg);   // throws if cfg.rewardsId is missing
```

| Method | Returns |
|---|---|
| `pool()` | `Promise<bigint>` — base units |
| `totalPaid()` | `Promise<bigint>` |
| `isClaimed(id)` | `Promise<boolean>` |
| `buildFundXdr(sponsor, amount: bigint)` | `Promise<string>` |
| `buildClaimXdr(source, id)` | `Promise<string>` |

Like `finalize`, `claim` needs no auth and pays the recorded contributor — the
`source` only covers the fee.

## Transaction helpers

From `./tx`:

| Function | Use |
|---|---|
| `makeServer(rpcUrl)` | `rpc.Server` (allows http:// for local RPC) |
| `simulateRead(server, passphrase, source, contractId, method, args)` | Decoded native return value |
| `buildInvokeXdr(server, passphrase, source, contractId, method, args)` | Prepared unsigned XDR |
| `submitSigned(server, passphrase, signedXdr)` | Submit browser-signed XDR, poll to inclusion, return hash |
| `signAndSend(server, passphrase, preparedXdr, keypair)` | Server-side sign + submit |

`submitSigned` / `signAndSend` poll `getTransaction` for up to 30 seconds and
throw on `FAILED` or timeout, so callers get a confirmed hash or an error — never
a fire-and-forget.

## Types and codecs

```ts
enum CorrectionKind   { Fare = 0, Route = 1, Closure = 2 }
enum CorrectionStatus { Pending = 0, Accepted = 1, Rejected = 2 }

interface Correction {
  id?: number;              // present when known from context (get/recent)
  contributor: string;
  routeId: string;
  kind: CorrectionKind;
  payloadHash: Uint8Array;  // sha256 of the off-chain payload
  summary: string;
  stake: bigint;            // base units
  status: CorrectionStatus;
  submittedAt: number;
  finalizeAfter: number;
  approvals: number;
  rejections: number;
}
```

ScVal codecs are exported for direct use: `addressToScVal`, `stringToScVal`,
`u32ToScVal`, `i128ToScVal`, `boolToScVal`, `bytes32ToScVal`, plus
`decodeCorrection` for mapping a `scValToNative`'d struct into SDK shape.

`bytes32ToScVal` throws on a hash that is not exactly 32 bytes — a bad payload
hash fails locally rather than being written on-chain.

## Notes

* Amounts are `bigint` in base units. There are no floats anywhere; do not
  introduce `Number` arithmetic on stakes or rewards.
* Errors surface as thrown `Error`s carrying the simulation message — contract
  error codes appear in that text (see the error tables in
  [danfo-registry](../contracts/registry.md#errors) and
  [danfo-rewards](../contracts/rewards.md#errors)).
* `readSource` must be a **funded** account; simulation loads it from the ledger.
