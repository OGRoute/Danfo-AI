# DanfoAI 🚌 — Conversational Nigerian Transit Agent on 0G

**Ask for any Lagos route, in your own language. Powered by 0G decentralized AI.**

DanfoAI is a voice-and-text agent that helps Lagos residents navigate *danfo*
(yellow minibuses) and BRT routes using natural language in **Yoruba, Igbo,
Hausa, Nigerian Pidgin, and English**. No maps, no menus — just talk.

> _"Mo fẹ lọ si Oshodi lati CMS"_ → DanfoAI replies in Yoruba with the best
> danfo route, **where to board it, the fare in ₦**, and where to change.

Voice input is powered by **Intron Sahara** streaming speech-to-text
(`@intron_health/intron_transcriber_streaming`) — African-accent ASR that
natively understands Yoruba, Igbo, Hausa, English and Nigerian Pidgin, with
live transcripts while you speak. When Intron isn't configured, the app falls
back to browser Web Speech → local Whisper → 0G Whisper.

Built for the **0G Zero Cup**.

---

## Why this needs 0G (all three layers do real work)

DanfoAI breaks without any one of 0G's layers — it is not a bolt-on:

| Layer | What it does in DanfoAI | Why it matters |
|-------|------------------------|----------------|
| **0G Compute** | Runs the multilingual LLM inference on decentralized GPUs. Every reply is verified via `processResponse()` (TEE-backed). | Answers are **verifiable & censorship-resistant** — a centralized API can't prove its output wasn't altered. |
| **0G Storage** | Holds the route knowledge base, content-addressed by Merkle root hash. The AI grounds every answer in this data. | Riders can prove the AI reasoned over the **community's actual route data**, not a hidden dataset. |
| **0G Chain** | Records community route corrections in the `RouteCorrections` contract. | The knowledge base is **community-owned and auditable** — a living transit map of Lagos. |

The result: a transit knowledge base owned by the riders who use it, that gets
more accurate every time someone corrects a fare or a route.

---

## How it works

```
User: "Mo fẹ lọ si Oshodi lati CMS"
        │
        ▼
  Next.js app
        │
        ├─► 0G Storage  ──►  load route KB (Merkle-verified)
        │
        ├─► 0G Compute  ──►  LLM inference + processResponse() verification
        │                     (detects language, returns route + fare)
        │
        └─► 0G Chain    ──►  community corrections registry (read/write)
        ▼
Reply in Yoruba: route, boarding point, fare in ₦, change point ✓ verified on 0G
```

**Cost note:** the app pre-funds each 0G Compute provider sub-account with
0.5 0G *before* the first request. That sidesteps the SDK's automatic 1 0G
transfer (which fires whenever a sub-account is missing or empty), keeping the
wallet's total 0G spend under ~0.6 per provider.

---

## Quick start

### Prerequisites
- Node 18+
- A funded **0G Galileo testnet** wallet:
  1. Create a fresh EVM wallet (e.g. MetaMask) — use a throwaway, never a real-funds wallet.
  2. Get test tokens from the faucet: https://faucet.0g.ai
  3. Network: RPC `https://evmrpc-testnet.0g.ai`, Chain ID `16602`.

### Install
```bash
npm install
cp .env.local.example .env.local   # then add your PRIVATE_KEY
```

### Seed the route data onto 0G Storage
```bash
npm run seed
# prints a root hash → paste it into .env.local as ROUTES_ROOT_HASH
```

### Deploy the corrections contract to 0G Chain
```bash
npm run deploy:contract
# prints a contract address → paste it into .env.local as CORRECTIONS_CONTRACT
```

### Run
```bash
npm run dev
# open http://localhost:3000
```

Type or tap the mic and ask for a route in any supported language.

---

## Project structure

```
danfo-ai/
├── app/
│   ├── page.tsx                 # chat UI (text + voice + verification badge)
│   ├── layout.tsx
│   └── api/
│       ├── chat/route.ts        # 0G Compute inference + verification
│       └── corrections/route.ts # 0G Chain read/write
├── lib/
│   ├── zg-compute.ts            # broker, inference, processResponse()
│   ├── zg-storage.ts            # upload/download route KB (Merkle)
│   ├── zg-chain.ts              # RouteCorrections contract (ethers v6)
│   ├── prompt.ts                # multilingual system prompt builder
│   └── routes-kb.ts             # KB loader (0G Storage → seed fallback)
├── components/
│   └── IntronVoiceInput.tsx     # Intron Sahara streaming STT widget
├── contracts/
│   └── RouteCorrections.sol     # community corrections registry
├── scripts/
│   ├── seed-routes.ts           # upload KB to 0G Storage
│   └── deploy-contract.ts       # compile + deploy to 0G Chain (cancun)
└── data/
    └── lagos-routes.json        # seed knowledge base
```

---

## Roadmap (post-group-stage)

- Voice replies via 0G Compute speech models (full hands-free for drivers).
- Upvote-weighted corrections so the most-trusted community data wins.
- Live crowding/traffic signals contributed by riders.
- Expand beyond Lagos to Abuja, Kano, Ibadan.

---

## Built with

[0G Compute](https://docs.0g.ai) · [0G Storage](https://docs.0g.ai) ·
[0G Chain](https://docs.0g.ai) · Next.js · ethers v6

_Route data and fares are community-maintained and approximate. Corrections welcome — that's the whole point._
