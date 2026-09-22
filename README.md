# DanfoAI 🚌 — Conversational Nigerian Transit Agent on 0G

**Ask for any Lagos route, in your own language. Powered by 0G decentralized AI.**

DanfoAI is a voice-and-text agent that helps Lagos residents navigate *danfo*
(yellow minibuses) and BRT routes using natural language in **Yoruba, Igbo,
Hausa, Nigerian Pidgin, and English**. No maps, no menus — just talk.

> _"Mo fẹ lọ si Oshodi lati CMS"_ → DanfoAI understands the Yoruba and replies
> with the best route, **where to board each vehicle, where to get off, and the
> fare in ₦**.

What's inside:

- **Accurate, detailed routes.** A deterministic trip planner computes every
  leg — danfo, korope, BRT, Blue/Red Line train, ferry, keke — with boarding
  point, drop-off, fare and time from a 2026 Lagos route database of 108
  routes and 85 stops, weighted towards the local network riders actually use
  (77 danfo routes) rather than only LAMATA services. Answers are written from
  that plan in the rider's own language (English, Pidgin, Yoruba, Igbo or
  Hausa); the model on 0G Compute rephrases the English ones, and any reply
  that drops or changes a fact is replaced by the computed answer. Each reply
  comes with a trip card showing the same plan.
- **Voice in your language (Intron).** Speech-to-text for English, Pidgin,
  Yoruba, Igbo and Hausa, with auto-detect, that keeps listening until you tap
  stop. Replies are read aloud with Intron's native voices. Without an Intron
  key it falls back to local Whisper / the browser (English).
- **Any street, estate or landmark.** Places outside the route database are
  resolved on OpenStreetMap and snapped to the nearest served stop, with a
  walking or keke leg to reach it ("Walk about 400 m from Bode Thomas Street
  to Fadeyi").
- **Settings.** Theme, map colours, reply language, voice language and voice,
  read-replies-aloud, live location, follow-me, and what's running under the
  hood (route data version, 0G model, voice engines).
- **Live map.** Routes drawn along real roads, your live GPS position with
  heading, follow mode, step-by-step progress and ETA — plus a trip simulation
  for demos away from Lagos.
- **Sign in with Clerk** (Google, email, …), a wallet, or anonymously.
- **Light, dark or system theme.**

Built for the **0G Zero Cup**.

---

## Why this needs 0G (all three layers do real work)

DanfoAI breaks without any one of 0G's layers — it is not a bolt-on:

| Layer | What it does in DanfoAI | Why it matters |
|-------|------------------------|----------------|
| **0G Compute** | Runs the LLM inference on decentralized GPUs. Every model reply is verified via `processResponse()` (TEE-backed). | Answers are **verifiable & censorship-resistant** — a centralized API can't prove its output wasn't altered. |
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
        ├─► trip planner ──►  legs, boarding points, fares, times (deterministic)
        │
        ├─► 0G Compute  ──►  LLM phrases the plan + processResponse() verification
        │
        └─► 0G Chain    ──►  community corrections registry (read/write)
        ▼
Reply: each vehicle, boarding point, drop-off, fare in ₦ + trip card and live map
```

**Cost note:** the 0G contract only needs 0.1 0G in a provider sub-account,
but the SDK on its own locks 1 0G per new provider and tries to keep ~8.8 0G
locked for the chat model. DanfoAI funds sub-accounts itself (0.5 0G target,
topped up when below 0.2 0G) and switches the SDK's auto top-up off, so at most
~0.5 0G is locked per provider. A reply costs roughly 0.003–0.006 0G.

---

## Quick start

### Prerequisites
- Node 22.19+ (`nvm use` picks it up from `.nvmrc`; undici 8 needs it)
- A funded **0G Galileo testnet** wallet:
  1. Create a fresh EVM wallet (e.g. MetaMask) — use a throwaway, never a real-funds wallet.
  2. Get test tokens from the faucet: https://faucet.0g.ai
  3. Network: RPC `https://evmrpc-testnet.0g.ai`, Chain ID `16602`.

### Install
```bash
npm install
cp .env.example .env.local   # then add PRIVATE_KEY (and INTRON_API_KEY for voice)
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

Type or tap the mic and ask for a route in any supported language, then open
🗺️ Live map to follow it, or ⚙️ Settings to change language, voice and map
behaviour. In development, Clerk sign-in works without keys (keyless mode);
add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` for production.
A Clerk *production* instance on a `*.vercel.app` domain also needs
`NEXT_PUBLIC_CLERK_PROXY_URL` (see `.env.example`). See `.env.example` for
every option.

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
│   ├── prompt.ts                # system prompt + model reply fact-check
│   ├── compose-answer.ts        # the reply itself, in all five languages
│   ├── route-planner.ts         # legs, fares, boarding points, alternatives
│   ├── geocode.ts               # streets/landmarks via OpenStreetMap
│   ├── useSettings.tsx          # rider preferences (per device)
│   └── routes-kb.ts             # KB loader (0G Storage → seed fallback)
├── components/
│   ├── RouteMap.tsx             # live map: road routes, GPS, progress, simulation
│   ├── TripCard.tsx             # computed trip under each reply
│   └── IntronVoiceInput.tsx     # optional Intron streaming widget
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

- Fully hands-free mode for drivers (auto-send after speaking, auto-read replies).
- Upvote-weighted corrections so the most-trusted community data wins.
- Live crowding/traffic signals contributed by riders.
- Expand beyond Lagos to Abuja, Kano, Ibadan.

---

## Built with

[0G Compute](https://docs.0g.ai) · [0G Storage](https://docs.0g.ai) ·
[0G Chain](https://docs.0g.ai) · Next.js · ethers v6

_Route data and fares are community-maintained and approximate. Corrections welcome — that's the whole point._
