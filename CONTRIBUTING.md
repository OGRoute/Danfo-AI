# Contributing to DanfoAI

Thanks for helping build a transit agent for Lagos riders. This guide gets you
from clone to running app, and explains how we scope and review work.

DanfoAI is a conversational Nigerian transit agent:

| Layer | Runs on |
|-------|---------|
| Chat AI (LLM inference) | **0G Compute** |
| Community route corrections | **Stellar** (Soroban smart contract) |
| Fares & contributor rewards | **Stellar** payments |
| Voice in / out | Browser speech APIs (local Whisper / YarnGPT as fallbacks) |

---

## 1. Prerequisites

You do **not** need all of these. Pick based on what you're working on:

| Working on… | You need |
|---|---|
| Frontend / API routes | **Node 20+** only |
| The Soroban contract | Node + **Rust** + `wasm32` target + **Stellar CLI** |
| The speech service | Node + **Python 3.11** (conda recommended) + ffmpeg |

### Node (always)
```bash
node --version   # 20+
npm install
```

### Rust + Stellar (only for contract work)
```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Stellar CLI (prebuilt binary — much faster than `cargo install`)
# grab the latest linux/mac asset from:
#   https://github.com/stellar/stellar-cli/releases
stellar --version
```

### Speech service (optional — the app defaults to browser speech)
```bash
conda create -y -n yarngpt python=3.11 && conda activate yarngpt
pip install -r services/speech/requirements.txt
conda install -c conda-forge ffmpeg -y

# YarnGPT is third-party and NOT vendored in this repo (see THIRD-PARTY-NOTICES.md):
./services/speech/fetch-yarngpt.sh
```

---

## 2. Configure

```bash
cp .env.example .env.local
```
Fill in what you need. **`.env.local` is gitignored — never commit secrets.**

- Frontend-only work: no keys needed for most UI/docs issues.
- Chat: `PRIVATE_KEY` (a funded **0G testnet** wallet).
- Stellar features: `STELLAR_CORRECTIONS_CONTRACT`, `STELLAR_SECRET`, `STELLAR_PUBLIC_KEY`.

---

## 3. Run

```bash
npm run dev          # http://localhost:3000
```

Use **Chrome or Edge** — voice uses the browser speech APIs.

---

## 4. Test & verify (run these before opening a PR)

```bash
npx tsc --noEmit     # types
npm run build        # production build must pass
```

Contract work:
```bash
cd stellar/route-corrections
cargo test                                        # unit tests
cargo build --target wasm32-unknown-unknown --release
```

Deploy the contract to testnet (optional):
```bash
./stellar/deploy.sh   # prints the contract id -> put in .env.local
```

Verify the Stellar path end-to-end:
```bash
curl -s http://localhost:3000/api/corrections   # expect "chain":"stellar"
```

---

## 5. How we work

### Picking an issue
- Issues are **scoped** by maintainers. Comment on one to claim it before starting.
- New to the project? Look for **`good first issue`**.
- If an issue is labelled **`needs design`**, discuss the approach in the issue
  *before* writing code.

### Branches & commits
```bash
git checkout -b fix/correction-id-race
```
Write clear commit messages (what changed and why). Keep PRs focused — one issue
per PR wherever possible.

### Pull requests
A PR should:
- Reference the issue (`Closes #123`)
- Pass `tsc`, `npm run build`, and `cargo test` (if you touched the contract)
- Include tests for behaviour changes
- Explain how a reviewer can verify it

---

## 6. Code conventions

- **TypeScript**, `strict` mode. No `any` unless genuinely unavoidable (and comment why).
- **Styling**: `styled-jsx` with the CSS custom properties in
  [`app/globals.css`](app/globals.css). **Always use the theme tokens**
  (`var(--text)`, `var(--surface)`) so light *and* dark mode work — never
  hard-code colours.
- **Accessibility matters**: label buttons, support keyboard, respect
  `prefers-reduced-motion`.
- **Rust**: keep the contract `#![no_std]`; add a unit test for every new
  contract function.

---

## 7. Security

- **Never commit secrets.** Keys live only in `.env.local`.
- Found a vulnerability? See [SECURITY.md](SECURITY.md) — please don't open a
  public issue for it.

---

## 8. Getting stuck

Open a draft PR or comment on the issue with what you tried. Setup here spans
Node, Rust and Python — if a step in this guide fails, that's a bug in the guide
and a fix is very welcome.
