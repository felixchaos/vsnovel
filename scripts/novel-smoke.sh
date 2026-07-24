#!/usr/bin/env bash
# Packaged-build smoke test.
#
# Every serious defect found on 2026-07-21 was invisible to the source-level
# checks: 380 unit tests, a clean typecheck and a clean guard all passed while
# the packaged app shipped 254MB of proprietary code, disabled its own chat
# extension, and could not sign in. Those are not unit-testable properties —
# they only exist once the thing is built and started. This is where they get
# checked.
#
#   scripts/novel-smoke.sh                 # build if needed, then assert
#   scripts/novel-smoke.sh --no-build      # assert against the existing package
#
# Exits non-zero on the first failed assertion.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

OUT="$(cd .. && pwd)/VSCode-darwin-arm64"
APP="$OUT/VS Novel.app"
UD=/tmp/novel-smoke/ud
EXT=/tmp/novel-smoke/ext
FAILED=0

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }

if [[ "${1:-}" != "--no-build" ]]; then
  echo "building (minified) …"
  export TMPDIR=/tmp
  : "${HTTPS_PROXY:=http://127.0.0.1:7890}"; export HTTPS_PROXY
  : "${HTTP_PROXY:=$HTTPS_PROXY}"; export HTTP_PROXY
  rm -rf "$OUT"
  npx gulp vscode-darwin-arm64-min >/tmp/novel-smoke-build.log 2>&1 \
    || { fail "build (see /tmp/novel-smoke-build.log)"; exit 1; }
fi

[[ -d "$APP" ]] || { fail "no package at $APP"; exit 1; }
RES="$APP/Contents/Resources/app"

echo "== package =="

# Licensing, not housekeeping. These ship under terms that forbid redistribution,
# and they reached the package once already by being left in node_modules after
# package.json had already dropped them.
for p in "@github/copilot" "@anthropic-ai/claude-agent-sdk" "@vscode/copilot-api"; do
  if [[ -d "$RES/extensions/copilot/node_modules/$p" ]]; then
    fail "proprietary package redistributed: $p"
  else
    pass "absent: $p"
  fi
done

SIZE_MB=$(du -sm "$APP" | cut -f1)
LIMIT=${NOVEL_SIZE_LIMIT_MB:-1400}
[[ $SIZE_MB -le $LIMIT ]] && pass "size ${SIZE_MB}MB (limit ${LIMIT}MB)" \
                          || fail "size ${SIZE_MB}MB exceeds ${LIMIT}MB"

# The extension is the product. If it is not in the package there is no chat,
# no completion and no sign-in.
[[ -f "$RES/extensions/copilot/dist/extension.js" ]] \
  && pass "chat extension present" || fail "chat extension missing from package"

NAME=$(python3 -c "import json;print(json.load(open('$RES/product.json'))['nameLong'])" 2>/dev/null)
[[ "$NAME" != *"Code - OSS"* && -n "$NAME" ]] && pass "branded: $NAME" || fail "branding not applied ($NAME)"

GALLERY=$(python3 -c "import json;print((json.load(open('$RES/product.json')).get('extensionsGallery') or {}).get('serviceUrl',''))" 2>/dev/null)
[[ -n "$GALLERY" ]] && pass "extension gallery configured" || fail "no extension gallery — nothing installable"

echo "== runtime =="
pkill -f "VS Novel.app" 2>/dev/null; sleep 2
rm -rf /tmp/novel-smoke; mkdir -p "$UD" "$EXT"
export TMPDIR=/tmp
nohup "$APP/Contents/MacOS/VS Novel" /tmp/novel-ws \
  --user-data-dir="$UD" --extensions-dir="$EXT" >/tmp/novel-smoke/out.log 2>&1 &
sleep 30

L=$(ls -dt "$UD"/logs/* 2>/dev/null | head -1)
if [[ -z "$L" ]]; then
  fail "the app produced no logs — it did not start"
else
  # The assertion that would have caught the enablement deadlock. Note that a
  # rendered chat panel proves nothing: that panel is core UI and appears
  # whether or not the extension behind it is running.
  if grep -q "_doActivateExtension GitHub.copilot-chat" "$L/window1/exthost/exthost.log" 2>/dev/null; then
    pass "chat extension activated"
  else
    fail "chat extension did NOT activate — chat, completions and sign-in are all absent"
  fi

  if [[ -d "$L/window1/exthost/GitHub.copilot-chat" ]]; then
    pass "extension produced its own logs"
  else
    fail "extension logged nothing"
  fi

  grep -qi "novel-auth" "$L/window1/exthost/GitHub.copilot-chat/"*.log 2>/dev/null \
    && pass "our authentication provider registered" \
    || fail "authentication provider not registered — sign-in will fall through to GitHub"
fi
pkill -f "VS Novel.app" 2>/dev/null

echo
[[ $FAILED -eq 0 ]] && echo "novel-smoke: OK" || echo "novel-smoke: FAILED"
exit $FAILED
