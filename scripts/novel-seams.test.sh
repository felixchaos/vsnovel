#!/usr/bin/env bash
# VS Novel — tests for the upstream-edit invalidation detector.
#
# `check` passing on a clean tree proves nothing; a script that always exits 0
# would pass that. What has to be proven is that each way of losing protection
# actually turns the light red, because every one of them is silent otherwise.
#
# Each case mutates the tree, asserts, and restores from HEAD. Everything must
# be committed before running — the restore is `git checkout --`, which discards
# uncommitted work in the touched file.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

SEAMS="scripts/novel-seams.js"
TS="extensions/copilot/src/extension/prompts/node/base/safetyRules.tsx"
PKG="extensions/copilot/package.json"
DATA="build/novel/data-seams.json"

pass=0
fail=0

restore() {
  git checkout -- "$TS" "$PKG" "$DATA" 2>/dev/null
  node "$SEAMS" snapshot >/dev/null 2>&1
  git checkout -- build/novel/seams.json 2>/dev/null
}

# assert <expected-exit> <must-contain|-> <description>
assert() {
  local want="$1" needle="$2" desc="$3" out rc
  out="$(node "$SEAMS" check 2>&1)"; rc=$?
  if [[ "$rc" != "$want" ]]; then
    echo "  FAIL  $desc"
    echo "        expected exit $want, got $rc"
    echo "$out" | sed 's/^/        /' | head -6
    fail=$((fail + 1)); return
  fi
  if [[ "$needle" != "-" ]] && ! echo "$out" | grep -q "$needle"; then
    echo "  FAIL  $desc"
    echo "        exit $rc was right but the report never said '$needle'"
    echo "$out" | sed 's/^/        /' | head -6
    fail=$((fail + 1)); return
  fi
  echo "  ok    $desc"
  pass=$((pass + 1))
}

if [[ -n "$(git status --porcelain "$TS" "$PKG" "$DATA")" ]]; then
  echo "novel-seams.test: $TS / $PKG / $DATA have uncommitted changes."
  echo "  This test restores them with 'git checkout --', which would discard that work."
  exit 2
fi

echo "novel-seams: detector tests"

# --- baseline -----------------------------------------------------------------
assert 0 - "a tree matching its manifest passes"

# --- an upstream edit made without re-snapshotting -----------------------------
# The core failure: the edit in the tree is protected by nothing, while verify
# happily checks pre-images for the edits that were recorded instead.
printf '\n// NOVEL-BUILDER: test edit\n' >> "$TS"
assert 1 "UNRECORDED" "an unsnapshotted upstream edit is reported"
restore

# --- an edit reverted without re-snapshotting ----------------------------------
# Less damaging but it makes the report lie: verify spends its budget on an edit
# that is gone and calls the run clean.
node -e '
const fs = require("fs");
const p = "build/novel/seams.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.seams.push({
  path: "extensions/copilot/src/extension/prompts/node/base/safetyRules.tsx",
  header: " -1,1 +1,1 ", kind: "replaced",
  preImage: "a line that was never there", preImageSha: "deadbeefdeadbeef", occurrences: 1
});
fs.writeFileSync(p, JSON.stringify(j, null, "\t") + "\n");
'
assert 1 "STALE" "a recorded edit no longer in the tree is reported"
git checkout -- build/novel/seams.json

# --- a JSON edit with no data seam ---------------------------------------------
# Textual fingerprints are deliberately not used on JSON, so without this check
# a package.json edit is covered by nothing at all.
node -e '
const fs = require("fs");
const p = "extensions/copilot/package.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.contributes.configuration[0].properties["github.copilot.chat.novelBuilder.testOnly"] = {
  type: "boolean", default: false
};
fs.writeFileSync(p, JSON.stringify(j, null, "\t") + "\n");
'
assert 1 "UNCOVERED" "a JSON edit with no data seam is reported"
restore

# --- a data seam whose upstream value moved -------------------------------------
# The seam records what UPSTREAM holds. Corrupting that recorded value is the
# same shape as upstream having changed it, which is what verify must catch.
node -e '
const fs = require("fs");
const p = "build/novel/data-seams.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const s = j.seams.find(s => s.selector.includes("github.copilot.enable"));
s.upstream = { "*": true, plaintext: false, markdown: false, scminput: false, invented: true };
fs.writeFileSync(p, JSON.stringify(j, null, "\t") + "\n");
'
out="$(node "$SEAMS" verify 1.129.1 2>&1)"
if echo "$out" | grep -q "BROKEN"; then
  echo "  ok    verify reports a data seam whose upstream value no longer matches"
  pass=$((pass + 1))
else
  echo "  FAIL  verify did not report a data seam that stopped matching upstream"
  echo "$out" | sed 's/^/        /' | head -12
  fail=$((fail + 1))
fi
restore

# --- verify must discriminate across real tags -----------------------------------
# Against the anchor everything is intact by construction. Against a tag six
# releases away real breakage exists. A detector that reports the same for both
# is not measuring anything.
near="$(node "$SEAMS" verify 1.128.1 2>&1 | grep -cE '^\s+(BROKEN|GONE)\s+.*\s[1-9][0-9]*$')"
far="$(node "$SEAMS" verify 1.123.0 2>&1 | grep -cE '^\s+(BROKEN|GONE)\s+.*\s[1-9][0-9]*$')"
if [[ "$near" -eq 0 && "$far" -gt 0 ]]; then
  echo "  ok    verify separates a near tag (clean) from a far one (breakage)"
  pass=$((pass + 1))
else
  echo "  FAIL  verify did not discriminate: 1.128.1 -> $near broken kinds, 1.123.0 -> $far"
  fail=$((fail + 1))
fi

# --- the tree must be exactly as we found it -------------------------------------
if [[ -n "$(git status --porcelain "$TS" "$PKG" "$DATA" build/novel/seams.json)" ]]; then
  echo "  FAIL  the test left the tree dirty"
  git status --porcelain "$TS" "$PKG" "$DATA" build/novel/seams.json | sed 's/^/        /'
  fail=$((fail + 1))
else
  echo "  ok    the tree was restored"
  pass=$((pass + 1))
fi

echo
echo "  $pass passed, $fail failed"
[[ "$fail" -eq 0 ]] || exit 1
