# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's **[Report a vulnerability](../../security/advisories/new)**
(Security → Advisories), or email the maintainer listed on the organization
profile.

Please include:
- What the issue is and where (file / endpoint / contract function)
- Steps to reproduce
- Impact (what an attacker could do)

We'll acknowledge within a few days and keep you updated.

## Scope — what matters most here

DanfoAI handles **private keys and on-chain funds**, so take extra care with:

- **Key handling** — `PRIVATE_KEY` (0G) and `STELLAR_SECRET` are server-side
  only. They must never reach the client bundle or logs.
- **The Soroban contract** ([`stellar/route-corrections`](stellar/route-corrections)) —
  auth bypasses, double-voting, or state corruption.
- **Payment routes** ([`app/api/stellar/pay`](app/api/stellar/pay)) — anything
  that could let a caller move funds they don't own, or replay a signed
  transaction.
- **Transaction signing** — the app signs some writes with its own key; a flaw
  that lets an attacker get arbitrary transactions signed is critical.

## Rules for contributors

- **Never commit secrets.** Keys belong in `.env.local` (gitignored) only.
  `.env.example` must contain **empty placeholders**, never real values.
- If you ever commit a key by accident: **rotate it immediately** — removing the
  commit is not enough, assume it is compromised.
- Use **testnet only** for development (0G testnet, Stellar testnet). Never put
  mainnet keys or real funds in a development environment.

## Known considerations

- Some correction writes are signed **server-side by the app key** rather than
  the user's wallet. This is a deliberate demo trade-off; treat the app key as
  a hot wallet and fund it only with testnet assets.
