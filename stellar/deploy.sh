#!/usr/bin/env bash
# Deploy the RouteCorrections Soroban contract to Stellar testnet.
#
# Prereqs: rust + wasm32 target + stellar CLI installed.
# Usage:   ./stellar/deploy.sh
#
# Creates/uses a local identity funded by Friendbot, builds the wasm, deploys,
# and prints the contract id. Put that id in .env.local as
# STELLAR_CORRECTIONS_CONTRACT=<C...>
set -euo pipefail
cd "$(dirname "$0")/route-corrections"

NET="${STELLAR_NETWORK:-testnet}"
IDENT="${STELLAR_IDENTITY:-danfo}"

echo "[1/4] ensure network + identity ($NET / $IDENT)…"
stellar network add "$NET" \
  --rpc-url "${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}" \
  --network-passphrase "Test SDF Network ; September 2015" 2>/dev/null || true
stellar keys generate "$IDENT" --network "$NET" --fund 2>/dev/null || \
  stellar keys fund "$IDENT" --network "$NET" 2>/dev/null || true
echo "  identity address: $(stellar keys address "$IDENT")"

echo "[2/4] build wasm…"
stellar contract build

WASM=target/wasm32-unknown-unknown/release/route_corrections.wasm
[ -f "$WASM" ] || WASM=target/wasm32v1-none/release/route_corrections.wasm

echo "[3/4] optimize…"
stellar contract optimize --wasm "$WASM" 2>/dev/null || true
OPT="${WASM%.wasm}.optimized.wasm"; [ -f "$OPT" ] || OPT="$WASM"

echo "[4/4] deploy…"
CID=$(stellar contract deploy --wasm "$OPT" --source "$IDENT" --network "$NET")
echo
echo "=========================================================="
echo " Deployed RouteCorrections contract:"
echo "   $CID"
echo
echo " Add to .env.local:"
echo "   STELLAR_CORRECTIONS_CONTRACT=$CID"
echo "=========================================================="
