---
description: The Next.js app — routes, API handlers, and the wallet paths.
---

# Web app

`apps/web` is a Next.js 14 App Router application: multilingual chat, voice,
route map, corrections feed, Freighter wallet, and fare payments.

## Layout

```
apps/web/
  app/
    page.tsx              chat + map + panels
    layout.tsx            providers, theme
    api/
      chat/route.ts       KB-grounded inference
      corrections/route.ts feed + submit + attest
      speak/route.ts      proxy to the speech service (TTS)
      transcribe/route.ts speech-to-text
      stellar/pay/route.ts submits signed XDR, handles fare payments
  components/
    StellarPanel.tsx      corrections feed, submit, attest, pool stats
    MapPanel.tsx, RouteMap.tsx
    HistoryDrawer.tsx, NotificationBell.tsx, ThemeToggle.tsx, AuthGate.tsx
  lib/
    stellar.ts            config + isStellarConfigured() + getIndexerUrl()
    stellar-corrections.ts registry/rewards calls via @danfo/sdk
    stellar-payments.ts   classic payment flows
    useFreighter.ts       wallet connect + sign
    inference.ts, prompt.ts, routes-kb.ts
    useVoiceRecorder.ts, useTextToSpeech.ts, intron-speech.ts
    useChatHistory.ts, useNotifications.ts, useAuth.tsx
  data/lagos-routes.json  seed knowledge base
```

## `/api/corrections`

The one handler worth reading in full. `runtime = "nodejs"`,
`dynamic = "force-dynamic"`, `maxDuration = 120`.

### `GET` — feed + stats

Indexer-first, chain fallback:

1. If `getIndexerUrl()` is set, fetch `/corrections?limit=20` and `/stats` in
   parallel, map snake_case rows to camelCase, return with `source: "indexer"`.
2. On any indexer failure, fall through to `recent(20)`, `total()`, and
   `poolStats()` read directly from chain — `source: "chain"`.
3. Unconfigured contracts return an empty feed with an `error` string, **HTTP
   200**, so the UI still renders.

Errors deliberately soft-fail with status 200 and an empty `corrections` array.
A broken feed must not blank the page.

### `POST` — submit, and `PATCH` — attest

Both have a dual path:

| Body includes | Path |
|---|---|
| `contributor` / `voter` | **Freighter path** — returns `{ xdr }`, prepared and unsigned, for the browser to sign; `/api/stellar/pay` submits it |
| omitted | **Wallet-less fallback** — the server key (`STELLAR_SECRET`) stakes and signs, returning `{ txHash }` |

`POST` requires `routeId`, `summary`, and `kind` ∈ `0|1|2` (400 otherwise).
`PATCH` requires a numeric `id` and boolean `approve`. Unconfigured contracts
return 503.

> The wallet-less path exists so a first-time user can try the flow without
> installing anything, and it is the reason `STELLAR_SECRET` must stay
> server-side. Leave it unset to require Freighter for every write.

## Reads vs writes

The app reads through the indexer and writes through Freighter → Soroban RPC.
Writes never traverse the indexer — see
[Architecture](../protocol/architecture.md#the-one-rule).

## Grounding

`lib/routes-kb.ts` and `data/lagos-routes.json` are the knowledge base the chat
prompt is built from; `lib/prompt.ts` assembles it. Answers come from that
community-maintained data rather than model recall — which is what makes an
accepted correction change what the assistant says.

`lib/inference.ts` targets any OpenAI-compatible endpoint via `INFERENCE_*`.

## Voice

`useVoiceRecorder` captures audio → `/api/transcribe` (Whisper STT) → chat.
Replies go to `/api/speak`, which proxies the [speech service](speech.md) at
`YARNGPT_API_URL` for Nigerian-accented TTS. Both degrade to text-only when
unconfigured.

## Conventions

* Node runtime for any route touching the Stellar SDK — it is not edge-safe.
* Never expose secrets through `NEXT_PUBLIC_*`.
* Keep contract access inside `lib/stellar-corrections.ts` on top of
  [`@danfo/sdk`](sdk.md) rather than hand-building ScVals in components.
* The build must succeed with **no secrets set** — CI enforces it. New features
  must degrade, not throw.
