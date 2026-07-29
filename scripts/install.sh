#!/usr/bin/env bash
# Snapkit installer for macOS (Apple Silicon).
#
#   curl -fsSL https://raw.githubusercontent.com/simiriva95/snapkit/main/scripts/install.sh | bash
#
# Why a script instead of "download the .dmg"? Snapkit is not notarized yet:
# anything downloaded with a browser is quarantined and Gatekeeper rejects it
# ("Snapkit is damaged"). curl does not set the quarantine attribute, so an
# app installed this way opens normally.
set -euo pipefail

REPO="simiriva95/snapkit"

[ "$(uname -s)" = "Darwin" ] || { echo "Snapkit installer: macOS only." >&2; exit 1; }
[ "$(uname -m)" = "arm64" ] || {
  echo "Snapkit ships Apple Silicon builds only for now (this Mac is $(uname -m))." >&2
  exit 1
}

echo "Fetching latest release…"
ZIP_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  grep -o '"browser_download_url": *"[^"]*arm64-mac\.zip"' | head -1 | cut -d'"' -f4)
[ -n "$ZIP_URL" ] || { echo "Could not find a macOS build in the latest release." >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading ${ZIP_URL##*/}…"
curl -fL --progress-bar "$ZIP_URL" -o "$TMP/snapkit.zip"

# ditto preserves the code signature; unzip can corrupt it.
ditto -xk "$TMP/snapkit.zip" "$TMP"
[ -d "$TMP/Snapkit.app" ] || { echo "Unexpected archive layout." >&2; exit 1; }

if [ -d /Applications/Snapkit.app ]; then
  echo "Replacing existing /Applications/Snapkit.app…"
  rm -rf /Applications/Snapkit.app
fi
mv "$TMP/Snapkit.app" /Applications/Snapkit.app

echo "✓ Snapkit installed — launch it from /Applications or Spotlight."
