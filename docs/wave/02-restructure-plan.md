# Phase 4 — Naming, Scoping, Repo Structure

## Name

Working assumption: keep the **Danfo** brand (it carries the Lagos identity and
existing history). Proposed final names — **confirm before scaffolding**:

- Contracts repo: `danfo-contracts`
- App repo: `danfo-app` (this repo, renamed — or kept as `Danfo-AI` if GitHub
  history/stars matter more than naming symmetry)

## One-paragraph description (submission-ready draft)

> Danfo is a community-owned transit knowledge protocol for Lagos, where about
> 14 million daily trips run on informal danfo minibuses with no official map
> or fare data. Riders and drivers submit route and fare corrections by staking
> a small amount on a Soroban smart contract; peers attest during a challenge
> window; accepted corrections refund the stake and pay a micro-reward from
> sponsor-funded pools in XLM or NGNC (Stellar's naira stablecoin, redeemable
> to a Nigerian bank account via SEP-24). A multilingual AI agent — Yoruba,
> Igbo, Hausa, Nigerian Pidgin, English, voice and text — answers routing
> questions from this community-verified knowledge base, so the data gets more
> accurate every time someone uses and corrects it.

(Verify the daily-trips figure against a citable source before submission —
commonly cited Lagos informal-transport figures range 8–14M daily passenger
trips; use the one you can cite.)

## Repo split

Two repos = two Wave-eligible surfaces, within the 5-repo cap.

### `danfo-contracts` — pure Rust workspace (new repo)
```
danfo-contracts/
├── Cargo.toml                 # [workspace] members = contracts/*
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE                    # MIT (match existing)
├── .github/workflows/ci.yml   # fmt + clippy + test + wasm build
├── scripts/deploy.sh          # sequential deploy + init, prints IDs
└── contracts/
    ├── registry/              # danfo-registry: submit/attest/finalize
    │   ├── Cargo.toml
    │   └── src/{lib.rs, test.rs}
    └── rewards/               # danfo-rewards: sponsor pools, claims
        ├── Cargo.toml
        └── src/{lib.rs, test.rs}
```

### `danfo-app` — monorepo (this repo, restructured)
```
danfo-app/
├── package.json               # npm workspaces
├── apps/web/                  # current Next.js app moves here
├── packages/sdk/              # TS clients for registry + rewards
├── indexer/                   # Node/TS: Soroban RPC getEvents → SQLite → REST
├── services/speech/           # yarngpt-service moves here (optional service)
├── docs/
└── .github/workflows/ci.yml
```

Indexer stays TypeScript (solo maintainer, existing TS codebase — a Go service
would be a second toolchain with no payoff at this scale).

## What gets deleted from this repo (0G cleanup)

| Item | Action |
|---|---|
| `contracts/RouteCorrections.sol`, `solc` dep | **Delete** — superseded by Soroban registry |
| `lib/zg-chain.ts`, `zg-compute.ts`, `zg-provider.ts`, `zg-speech.ts`, `zg-storage.ts` | **Delete** |
| `@0glabs/*` deps, `ethers`, MetaMask auth path in `useAuth`/`AuthGate` | **Delete** — wallet auth becomes Freighter-only |
| `scripts/seed-routes.ts` (0G Storage), `deploy-contract.ts` (EVM), `fund.ts` | **Delete / rewrite** — seed KB becomes a JSON file + hash anchored via registry |
| README 0G branding, "Zero Cup" | **Rewrite** Stellar-first (Phase 10 pattern) |
| LLM inference | Replace 0G Compute with a pluggable provider (`OPENAI_COMPATIBLE_BASE_URL` + key — works with any hosted or local model). Say plainly in docs: inference is off-chain; the chain owns the data. |

## What stays

- All five languages, browser-first voice + yarngpt/Whisper fallbacks.
- Leaflet route map, chat history, notifications, themes.
- Freighter wallet integration (`useFreighter.ts`), `stellar.ts`,
  `stellar-corrections.ts`, `stellar-payments.ts` — these become the SDK
  package's foundation.
- Fare payments via Freighter: kept as a secondary feature, not the pitch.
- `data/lagos-routes.json` seed KB: payload hashes get anchored in the registry.
