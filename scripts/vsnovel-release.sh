#!/usr/bin/env bash
# Cut a VS Novel release.
#
# Attaches the platform artifacts plus a generated update-manifest.json to a
# GitHub Release on the OSS repo. Once the release is the repo's "latest", the
# update Worker serves it and installed editors update themselves.
#
# The macOS artifact must already be signed + notarized + stapled (see
# docs/mac-signing) and the Windows artifact must be the user-setup installer —
# the two the editor's updater knows how to apply. Build those first; this
# script only hashes, manifests, and publishes.
#
# Usage:
#   scripts/vsnovel-release.sh <tag> <product-version> <commit-sha> \
#     darwin-arm64=<path-to-mac.zip> \
#     win32-x64-user=<path-to-UserSetup.exe>
#
# Example:
#   scripts/vsnovel-release.sh v1.129.1-nvl.3 1.129.1-nvl.3 "$(git rev-parse HEAD)" \
#     darwin-arm64=./out/VisualStudioNovel-darwin-arm64.zip \
#     win32-x64-user=./out/VSNovelUserSetup-x64.exe

set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${VSNOVEL_REPO:-felixchaos/vsnovel}"
TAG="${1:?usage: vsnovel-release.sh <tag> <product-version> <commit-sha> platform=path ...}"
PVER="${2:?missing product-version}"
COMMIT="${3:?missing commit-sha}"
shift 3
[ "$#" -ge 1 ] || { echo "no platform=path artifacts given" >&2; exit 2; }

ASSETS=()
for pair in "$@"; do
  path="${pair#*=}"
  [ -f "$path" ] || { echo "artifact not found: $path" >&2; exit 2; }
  ASSETS+=("$path")
done

MANIFEST="$(mktemp -t vsnovel-manifest.XXXXXX).json"
node update-server/make-manifest.mjs \
  --repo "$REPO" --tag "$TAG" --version "$COMMIT" --product-version "$PVER" \
  --out "$MANIFEST" "$@"

echo "== update-manifest.json =="
cat "$MANIFEST"

echo "== creating release $TAG on $REPO =="
gh release create "$TAG" "${ASSETS[@]}" "$MANIFEST" \
  --repo "$REPO" \
  --title "VS Novel $PVER" \
  --notes "Automated release. Installed editors update themselves via update.stellatrix.icu."

echo "done. 'latest' now resolves to $TAG; the update Worker will serve it within ~1 min."
