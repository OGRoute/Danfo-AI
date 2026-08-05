---
description: Chain-state poller, REST feed, and the finalize/claim crank.
---

# Indexer

`indexer/` is a Node service (Express + `better-sqlite3` + pino) doing three
jobs: mirror chain state into SQLite, serve a fast read API, and crank
`finalize` / `claim`.

It is an **optimisation, never an authority**. It holds no user keys and is not
in the write path — the web app falls back to direct chain reads when it is
unreachable.

## Run it

```bash
REGISTRY_CONTRACT=C... REWARDS_CONTRACT=C... INDEXER_SECRET_KEY=S... \
  npm run dev:indexer      # tsx watch, API on :8787
npm run start -w indexer   # production
```

All variables: [Environment](environment.md#indexer-indexer). `REGISTRY_CONTRACT`
is the only hard requirement; without `INDEXER_SECRET_KEY` the service runs
read-only and logs `INDEXER_SECRET_KEY unset — finalize/claim crank disabled`.

## REST API

CORS is open for GET (the web app is served from another origin).

### `GET /health`

```json
{ "ok": true }
```

### `GET /corrections?status=&limit=`

`status` ∈ `0` (pending), `1` (accepted), `2` (rejected); omit for all. `limit`
defaults to 50, capped at 200. Newest id first. Invalid `status` → 400.

```json
{ "corrections": [ { "id": 12, "contributor": "G…", "route_id": "cms-oshodi",
  "kind": 0, "summary": "…", "payload_hash": "<hex>", "stake": "100000000",
  "status": 0, "submitted_at": 1753000000, "finalize_after": 1753086400,
  "approvals": 1, "rejections": 0, "claimed": 0, "updated_at": 1753000123 } ] }
```

Rows are snake_case SQLite rows, and `stake` is a string — it is an `i128` and
does not fit a JS number.

### `GET /corrections/:id`

The single row, or 404. Non-integer / negative id → 400.

### `GET /contributors/:address`

Combines a **live chain read** of `reputation(address)` with that address's
locally indexed corrections:

```json
{ "address": "G…", "reputation": { "submitted": 7, "accepted": 5 },
  "corrections": [ … ] }
```

### `GET /stats`

Local counts plus live pool reads:

```json
{ "total": 42, "accepted": 30, "pending": 4,
  "pool": "5000000000", "totalPaid": "1500000000" }
```

`pool` and `totalPaid` are `"0"` when `REWARDS_CONTRACT` is unset.

## The poller

Every `INDEXER_POLL_MS` (default 10 s):

1. Read `total()`.
2. Upsert every id from `maxId() + 1` to `total - 1`.
3. Re-read every locally `Pending` correction to refresh votes and status.

There is **no event cursor**. All the state needed lives in the `Correction`
struct, so the indexer converges on correct state after arbitrary downtime with
no replay logic and no cursor to corrupt — see
[Architecture](../protocol/architecture.md#why-state-polling-not-events).

## The crank

Every `INDEXER_CRANK_MS` (default 60 s), when `INDEXER_SECRET_KEY` is set:

1. For each pending correction whose `finalize_after` has passed →
   `finalize(id)`, then re-read and upsert.
2. For each accepted-and-unclaimed correction → check `is_claimed(id)`
   (marking locally if already paid), otherwise `claim(id)`.

Failures are logged at `warn` and retried on the next pass — a transient RPC
error or an `InsufficientPool` claim never wedges the loop.

**The crank cannot steal.** `finalize` refunds the contributor recorded on-chain
and `claim` pays the contributor recorded on-chain; neither takes a destination
argument. The crank account's only role is paying fees, so its key exposure is
bounded by its own balance. Keep it funded and separate from any treasury
account.

Because both functions are permissionless, the crank is a convenience, not a
dependency: any user can settle or claim their own correction if it is offline.

## Storage

One SQLite table, `corrections`, keyed by contract id, with indexes on `status`
and `contributor` and WAL journaling. `payload_hash` is stored hex-encoded and
`stake` as text. The upsert only overwrites the mutable fields (`status`,
`approvals`, `rejections`, `updated_at`) — immutable submission data is written
once.

The DB is a **cache**. Deleting `danfo.db` and restarting rebuilds it from chain.

For deploys, put `INDEXER_DB_PATH` on a persistent disk — on an ephemeral
filesystem the indexer re-syncs from scratch on every restart, which is correct
but slow.
