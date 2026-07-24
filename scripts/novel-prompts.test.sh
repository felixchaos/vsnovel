#!/usr/bin/env bash
# VS Novel — tests for the prompt transform.
#
# The value of this script is entirely in what `check` reports. A version that
# always printed "nothing needs a human" would pass a smoke test and would be
# worse than having no script, because it would be trusted. So every category it
# claims to detect is provoked here.
#
# Everything must be committed first — cases restore with `git checkout --`.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

P="scripts/novel-prompts.js"
RULES="build/novel/prompt-rules.json"
VICTIM="extensions/copilot/src/extension/prompts/node/agent/openai/gpt51Prompt.tsx"
NEWFILE="extensions/copilot/src/extension/prompts/node/agent/novelTestOnlyPrompt.tsx"

pass=0
fail=0

restore() {
  git checkout -- "$RULES" "$VICTIM" 2>/dev/null
  rm -f "$NEWFILE"
}

# assert <expected-exit> <needle|-> <description>
assert() {
  local want="$1" needle="$2" desc="$3" out rc
  out="$(node "$P" check 2>&1)"; rc=$?
  if [[ "$rc" != "$want" ]]; then
    echo "  FAIL  $desc"
    echo "        expected exit $want, got $rc"
    echo "$out" | sed 's/^/        /' | head -8
    fail=$((fail + 1)); return
  fi
  if [[ "$needle" != "-" ]] && ! echo "$out" | grep -q "$needle"; then
    echo "  FAIL  $desc"
    echo "        exit was right but the report never said '$needle'"
    echo "$out" | sed 's/^/        /' | head -8
    fail=$((fail + 1)); return
  fi
  echo "  ok    $desc"
  pass=$((pass + 1))
}

if [[ -n "$(git status --porcelain "$RULES" "$VICTIM")" ]]; then
  echo "novel-prompts.test: $RULES / $VICTIM have uncommitted changes."
  echo "  This test restores them with 'git checkout --', which would discard that work."
  exit 2
fi

echo "novel-prompts: transform tests"

assert 0 - "a fully transformed tree needs nobody"

# --- an edit that did not survive ---------------------------------------------
git show "1.129.1:$VICTIM" > "$VICTIM"
assert 1 "UNAPPLIED" "a prompt reverted to upstream is reported"

# ... and apply must fix exactly that
node "$P" apply >/dev/null 2>&1
assert 0 - "apply restores it"
if ! git diff --quiet -- "$VICTIM"; then
  echo "  FAIL  apply did not reproduce the committed file byte for byte"
  git diff --stat -- "$VICTIM" | sed 's/^/        /'
  fail=$((fail + 1))
else
  echo "  ok    apply reproduces the committed file byte for byte"
  pass=$((pass + 1))
fi
restore

# --- upstream reworded the sentence a rule targets ------------------------------
# The quiet killer: the rule replays as a no-op, apply exits 0, and the
# reframing that rule performed is simply absent from the product.
node -e '
const fs = require("fs"), p = "build/novel/prompt-rules.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.rules[0].from = "You are a sentence upstream has never contained anywhere at all.";
fs.writeFileSync(p, JSON.stringify(j, null, "\t") + "\n");
'
assert 1 "STALE" "a rule whose upstream text is gone is reported"
restore

# --- upstream grew a new prompt carrying text a rule covers ---------------------
# apply must NOT silently reframe it: whether a new prompt should be reframed is
# a judgement. This exact case reframed the notebook prompt on the first run.
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("build/novel/prompt-rules.json", "utf8"));
const from = j.rules.find(r => r.from.includes("coding agent")).from;
fs.writeFileSync("extensions/copilot/src/extension/prompts/node/agent/novelTestOnlyPrompt.tsx",
  "// test fixture\nexport const X = <>\n\t" + from + "\n</>;\n");
'
assert 1 "SPREAD" "a new prompt matching a rule is reported, not silently rewritten"
before="$(shasum < "$NEWFILE")"
node "$P" apply >/dev/null 2>&1
after="$(shasum < "$NEWFILE")"
if [[ "$before" == "$after" ]]; then
  echo "  ok    apply left the out-of-scope file untouched"
  pass=$((pass + 1))
else
  echo "  FAIL  apply rewrote a file no rule is scoped to"
  fail=$((fail + 1))
fi
restore

# --- prompt text nobody has judged ----------------------------------------------
node -e '
const fs = require("fs"), p = "extensions/copilot/src/extension/prompts/node/agent/openai/gpt51Prompt.tsx";
const s = fs.readFileSync(p, "utf8").split("\n");
const i = s.findIndex(l => l.includes("<Tag name="));
s.splice(i + 1, 0, "\t\t\t\tYou are a senior software engineer and your primary focus is writing code.<br />");
fs.writeFileSync(p, s.join("\n"));
'
assert 1 "UNCLASSIFIED" "software-specific prompt text with no rule and no verdict is reported"
restore

# --- the shared slots ------------------------------------------------------------
node -e '
const fs = require("fs"), p = "extensions/copilot/src/extension/prompts/node/base/safetyRules.tsx";
fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/NovelSafetyRules/g, "SomethingElse"));
'
out="$(node "$P" check 2>&1)"
if echo "$out" | grep -q "DELEGATION BROKEN"; then
  echo "  ok    a shared slot that stopped delegating is reported"
  pass=$((pass + 1))
else
  echo "  FAIL  a broken delegation went unreported — every model family reads that slot"
  fail=$((fail + 1))
fi
git checkout -- extensions/copilot/src/extension/prompts/node/base/safetyRules.tsx

# --- the tree must be as we found it ---------------------------------------------
if [[ -n "$(git status --porcelain extensions/ build/novel/)" ]]; then
  echo "  FAIL  the test left the tree dirty"
  git status --porcelain extensions/ build/novel/ | sed 's/^/        /'
  fail=$((fail + 1))
else
  echo "  ok    the tree was restored"
  pass=$((pass + 1))
fi

echo
echo "  $pass passed, $fail failed"
[[ "$fail" -eq 0 ]] || exit 1
