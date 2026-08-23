#!/usr/bin/env bash
# VS Novel — tests for the update manifest generator.
#
# Everything here exists because the failure mode is silence. The Worker answers
# 204 for a platform the manifest does not name, the editor reads 204 as
# "already current", and an author on that platform is never told an update
# exists. Nothing logs, nothing warns, and the only way to notice is for someone
# to say "why does my Windows never update" — which is exactly how the
# `win32-x64-archive` gap was found, weeks after it started.
#
# So these assert on the shape of what gets published, not on the generator
# exiting 0.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

GEN="update-server/make-manifest.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

printf 'mac' > "$WORK/VS-Novel-macOS-AppleSilicon.zip"
printf 'win' > "$WORK/VS-Novel-Windows-x64-Setup.exe"

pass=0
fail=0

# ok <description> <condition-exit-code>
ok() {
  if [ "$2" = "0" ]; then echo "  ok    $1"; pass=$((pass + 1));
  else echo "  FAIL  $1"; fail=$((fail + 1)); fi
}

run() {
  node "$GEN" --repo felixchaos/vsnovel --tag v0.0.0-test \
    --version deadbeefdeadbeefdeadbeefdeadbeefdeadbeef --product-version 0.0.0-test "$@"
}

read -r -d '' JQ_PLATFORMS <<'EOF' || true
const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(Object.keys(d.platforms).sort().join(' '));
EOF

M="$(run "darwin-arm64=$WORK/VS-Novel-macOS-AppleSilicon.zip" "win32-x64-user=$WORK/VS-Novel-Windows-x64-Setup.exe")"

got="$(printf '%s' "$M" | node -e "$JQ_PLATFORMS")"
[ "$got" = "darwin-arm64 win32-x64-archive win32-x64-user" ]
ok "an unpacked Windows install is served alongside the installed one" $?

# The two Windows entries must be the same build. Serving an archive user a
# different artifact than the installer user is worse than serving them nothing.
same="$(printf '%s' "$M" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
const a = d.platforms["win32-x64-user"], b = d.platforms["win32-x64-archive"];
process.stdout.write(String(a.url === b.url && a.sha256hash === b.sha256hash && a.version === b.version));
')"
[ "$same" = "true" ]
ok "the alias points at the same artifact, hash and commit" $?

# macOS has one platform string and must not grow an alias.
none="$(printf '%s' "$M" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(String(Object.keys(d.platforms).filter(k => k.startsWith("darwin")).length));
')"
[ "$none" = "1" ]
ok "macOS gets no alias" $?

# An alias is a fallback, never an override: the day a real archive artifact is
# built and passed explicitly, it has to win.
printf 'zip' > "$WORK/VS-Novel-Windows-x64.zip"
M2="$(run "win32-x64-user=$WORK/VS-Novel-Windows-x64-Setup.exe" "win32-x64-archive=$WORK/VS-Novel-Windows-x64.zip")"
differs="$(printf '%s' "$M2" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
const a = d.platforms["win32-x64-user"], b = d.platforms["win32-x64-archive"];
process.stdout.write(String(a.sha256hash !== b.sha256hash && b.url.endsWith("VS-Novel-Windows-x64.zip")));
')"
[ "$differs" = "true" ]
ok "an explicitly given platform beats the alias for it" $?

# The hash is what the Windows updater verifies before installing. A wrong one
# fails the update after the download, which reads as a broken release.
h="$(printf '%s' "$M" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(d.platforms["win32-x64-user"].sha256hash);
')"
expected="$(printf 'win' | shasum -a 256 | cut -d' ' -f1)"
[ "$h" = "$expected" ]
ok "the recorded sha256 is the artifact's own" $?

echo
echo "  $pass passed, $fail failed"
[ "$fail" = "0" ]
