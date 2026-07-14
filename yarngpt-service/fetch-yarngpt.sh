#!/usr/bin/env bash
# Fetch the YarnGPT source into ./yarngpt/ so the TTS service can import it.
#
# WHY THIS EXISTS
# ---------------
# YarnGPT (https://github.com/saheedniyi02/yarngpt) is NOT published as a pip
# package (it has no setup.py/pyproject.toml) and, at the time of writing, ships
# WITHOUT a license — so we cannot redistribute it inside this repository.
# Instead, you fetch it yourself here; ./yarngpt/ is gitignored.
#
# Usage: ./yarngpt-service/fetch-yarngpt.sh
set -euo pipefail
cd "$(dirname "$0")"

REPO="${YARNGPT_REPO:-https://github.com/saheedniyi02/yarngpt.git}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Cloning YarnGPT…"
git clone --depth 1 --quiet "$REPO" "$TMP/yarngpt"

echo "Installing into ./yarngpt/ (as an importable package)…"
rm -rf yarngpt
mkdir -p yarngpt
cp "$TMP/yarngpt/__init__.py" "$TMP/yarngpt/audiotokenizer.py" yarngpt/
cp -r "$TMP/yarngpt/default_speakers" "$TMP/yarngpt/default_speakers_local" yarngpt/ 2>/dev/null || true

echo
echo "Done. ./yarngpt/ now contains:"
ls yarngpt
echo
echo "NOTE: YarnGPT is third-party code under its own terms. Review its"
echo "repository for licensing before any redistribution or commercial use."
