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
# The anchor, not a tag written down here. This said 1.129.1 — right while that
# was the anchor, and wrong the moment it moved: the case reverts the file to
# upstream and asserts that replaying our rules reproduces the committed file,
# which can only hold if "upstream" means the base the committed file sits on.
# Against a stale tag it reverts to text from five releases ago and reports a
# 150-line difference that says nothing about the rules.
git show "${NOVEL_ANCHOR_TAG:-1.134.0-release}:$VICTIM" > "$VICTIM"
assert 1 "UNAPPLIED" "a prompt reverted to upstream is reported"

# ... and apply must put back every rule-covered block. Not "check goes green":
# apply replays rules, and the rest of this file is upstream's software prose
# that only a person reframed. With that prose back in the tree the scanner is
# right to complain, so demanding exit 0 here demanded that apply do something
# it does not claim to do. What it does claim is that no UNAPPLIED rule is left.
node "$P" apply >/dev/null 2>&1
if node "$P" check 2>&1 | grep -q "UNAPPLIED"; then
  echo "  FAIL  apply left a rule unapplied"
  node "$P" check 2>&1 | grep "UNAPPLIED" | sed 's/^/        /' | head -5
  fail=$((fail + 1))
else
  echo "  ok    apply puts every rule-covered block back"
  pass=$((pass + 1))
fi
# A ratchet, not a pass/fail on a property this system does not have.
#
# `apply` replays rules. Most of the reframing in these files is not a rule —
# it is hand-written prose that only a person could have judged, protected by
# textual seams rather than replayed. Reverting a rule-covered file to upstream
# and applying leaves that prose behind: 19 of the 21 covered files do not come
# back byte for byte, and gpt51Prompt.tsx is short 150 lines. That was true
# before either 1.134.0 rebase; the assertion was red for as long as it has
# existed, which is the same as not being there.
#
# So measure the gap and refuse to let it grow. A number in the manifest is
# visible, is bounded, and can only be paid down — an assertion nobody can
# satisfy just gets waved through.
gap="$(git diff --numstat -- "$VICTIM" | awk '{ print $1 + $2 }')"
gap="${gap:-0}"
ceiling="$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('build/novel/prompt-rules.json','utf8')).replayGapCeiling ?? 0))")"
if [[ "$gap" -le "$ceiling" ]]; then
  echo "  ok    apply's replay gap is $gap line(s), within the recorded ceiling of $ceiling"
  pass=$((pass + 1))
else
  echo "  FAIL  apply's replay gap grew: $gap line(s) against a ceiling of $ceiling"
  echo "        Either write the missing reframing as a rule, or say why it cannot be one"
  echo "        and raise replayGapCeiling deliberately. It may not drift up on its own."
  git diff --stat -- "$VICTIM" | sed 's/^/        /'
  fail=$((fail + 1))
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
