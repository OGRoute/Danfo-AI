# Phase 1 — Ecosystem Landscape (verified 2026-07-18)

All data below was fetched live on 2026-07-18. Re-verify before submission; the
ecosystem changes monthly.

## Drips Wave (Stellar) — current state

- **643 approved repos** in the Stellar Wave program
  (source: https://www.drips.network/wave/stellar/repos).
- As of Wave 6: **applications capped at 5 repos per wave** (per user and per
  org), and **KYC is required** to apply.
- Repos earn point multipliers (2x / 4x observed); established, active projects
  hold 4x.
- Approval is by the Wave Program organizers; the bar visible in the approved
  list is: Stellar-first identity, real Soroban usage, active maintenance,
  contributor-ready hygiene (issues, contributing docs, CI).

## What's already approved (sample, categorized)

| Domain | Examples | Saturation |
|---|---|---|
| Escrow | Trustless-Work, SafeTrust (frontend + backend), kindfi (milestone crowdfunding) | **Saturated** |
| Payments / payroll | Stellopay (core + frontend), Micopay (crypto-to-cash), routedock, GreenPay | **Saturated** |
| Marketplace / freelance | OFFER-HUB | Crowded |
| Rentals / RWA | Stellar-Rent, akkuea | Crowded |
| AI x Stellar | StellarMind (AI agent marketplace, x402 micropayments), Fortexa (payment firewall for agent actions) | Emerging — agents *spending* money, not agents *grounded in community data* |
| Community-owned real-world data | — | **White space.** No approved repo in the sample does incentivized, community-maintained real-world datasets |

## SDF funding priorities

- Stellar Community Fund (SCF) **Build Award: up to $150K in XLM**, open
  application (https://communityfund.stellar.org/).
- Standing priorities: real-world utility, financial inclusion / emerging
  markets, anchors and on/off-ramps, Soroban adoption.
- Nigeria is an explicitly invested market: SDF's Enterprise Fund invested in
  **Cowrie** (Nigerian anchor); **NGNC** (Link.io) is a live, fully-reserved
  NGN stablecoin **native on Stellar with SEP-24 on/off-ramps**
  (https://www.linkio.world/ngnc).

## What this means for Danfo

1. Payments/escrow projects are a red ocean. A "pay your fare on Stellar" pitch
   alone would land in the most crowded category.
2. Community-owned, incentivized real-world data is genuine white space, and it
   is what the existing `RouteCorrections` contract already gestures at.
3. The Nigeria angle is not decorative: SDF funds Nigerian anchors, and NGNC
   gives contributors a path from on-chain reward to naira in hand (SEP-24).
4. Wave hygiene expectations are visible in the approved repos: split
   contract/app repos, issues at scale, CONTRIBUTING/SECURITY, CI, releases.
