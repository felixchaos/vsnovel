#!/usr/bin/env bash
# VS Novel — the checklist for moving to a new upstream VS Code tag.
#
# Run it. Do not do this from memory.
#
# VS Code ships weekly and every release tag sits off the main line, so the move
# is always `git rebase --onto <newtag> <oldtag>` — never `git rebase <newtag>`,
# which would replay against a commit our branch never sat on.
#
# The order matters more than any single check:
#
#   preflight   BEFORE touching anything. Answers "what will this cost, and
#               what will a person have to decide". If it reports work, that
#               work is done by hand FIRST, against the old anchor, while the
#               tree is still coherent and the old upstream is still readable.
#   postflight  AFTER the rebase, BEFORE re-snapshotting. This is the only
#               moment an edit that entered the rebase and did not come out can
#               still be recovered — once the manifest is regenerated against
#               the new anchor, a dropped edit is not merely lost, there is no
#               longer any record that it existed.
#
# Usage:
#   scripts/novel-rebase.sh preflight <newtag>
#   scripts/novel-rebase.sh postflight
#
# Exit 0 = clear to proceed. Exit 1 = something needs a person.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

ANCHOR="${NOVEL_ANCHOR_TAG:-1.134.0-release}"
status=0

hdr() { printf '\n\033[1m%s\033[0m\n' "$1"; }
step() { printf '  %-46s' "$1"; }
ok() { printf '\033[32mok\033[0m %s\n' "${1:-}"; }
bad() { printf '\033[31mNEEDS A PERSON\033[0m %s\n' "${1:-}"; status=1; }

run() {
  local label="$1"; shift
  step "$label"
  local out
  out="$("$@" 2>&1)"
  if [[ $? -eq 0 ]]; then ok; else
    bad
    echo "$out" | sed 's/^/      /'
  fi
}

cmd_preflight() {
  local tag="${1:-}"
  if [[ -z "$tag" ]]; then
    echo "usage: novel-rebase.sh preflight <newtag>"; return 2
  fi
  if ! git rev-parse --verify "$tag" >/dev/null 2>&1; then
    echo "novel-rebase: '$tag' is not a known ref. Fetch upstream tags first:"
    echo "  git fetch upstream --tags"
    return 2
  fi

  echo "novel-rebase: preflight  $ANCHOR -> $tag"

  hdr "1. Is the tree in a state worth rebasing?"
  step "everything committed"
  if [[ -z "$(git status --porcelain)" ]]; then ok; else
    bad "commit or stash first — the rebase will not carry working-tree changes"
  fi
  run "changes are all in scope" bash scripts/novel-guard.sh
  run "seam manifest describes the tree" node scripts/novel-seams.js check
  run "every recorded edit is present" node scripts/novel-seams.js applied

  hdr "2. What breaks at $tag?"
  step "upstream still holds what we wrote against"
  local out
  out="$(node scripts/novel-seams.js verify "$tag" 2>&1)"
  if [[ $? -eq 0 ]]; then ok "$(echo "$out" | grep -E 'INTACT|MOVED' | tr -s ' ' | tr '\n' ' ')"; else
    bad
    echo "$out" | sed 's/^/      /'
    echo "      Re-derive each BROKEN/GONE edit against $tag BEFORE rebasing."
  fi

  step "prompt rules still replayable"
  out="$(node scripts/novel-prompts.js check "$tag" 2>&1)"
  if [[ $? -eq 0 ]]; then ok; else
    bad
    echo "$out" | sed 's/^/      /'
  fi

  hdr "3. Sizing"
  printf '  %-46s%s\n' "upstream commits in range" "$(git rev-list --count "$ANCHOR".."$tag" 2>/dev/null || echo '?')"
  printf '  %-46s%s\n' "files we touch that upstream also touched" \
    "$(comm -12 \
        <(git diff --name-only "$ANCHOR" HEAD | sort) \
        <(git diff --name-only "$ANCHOR" "$tag" | sort) | wc -l | tr -d ' ')"
  comm -12 \
    <(git diff --name-only "$ANCHOR" HEAD | sort) \
    <(git diff --name-only "$ANCHOR" "$tag" | sort) | sed 's/^/      /'

  hdr "Verdict"
  if [[ $status -eq 0 ]]; then
    cat <<EOF
  Clear to rebase.

      git switch novel-builder
      git rebase --onto $tag $ANCHOR

  Then: scripts/novel-rebase.sh postflight
EOF
  else
    cat <<EOF
  Not clear. Resolve the items above FIRST, against the current anchor, while
  the old upstream is still readable and the tree still makes sense. Doing it
  mid-rebase means deciding what a prompt should say while git is holding a
  conflicted file open, which is how the wrong answer gets committed.
EOF
  fi
  return $status
}

cmd_postflight() {
  echo "novel-rebase: postflight"
  echo "  Run this BEFORE 'novel-seams.js snapshot'. Re-snapshotting first"
  echo "  destroys the only evidence that a dropped edit ever existed."

  hdr "1. Did everything survive?"
  run "every recorded edit is still present" node scripts/novel-seams.js applied
  run "shared prompt slots still delegate" node scripts/novel-prompts.js check

  hdr "2. Does it still build?"
  step "extension typecheck"
  local out
  out="$(cd extensions/copilot && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit 2>&1 | grep -v 'TS5097')"
  if [[ -z "$out" ]]; then ok; else bad; echo "$out" | sed 's/^/      /' | head -20; fi

  step "novel unit tests"
  out="$(cd extensions/copilot && npx vitest --run --pool=forks src/novel 2>&1)"
  if echo "$out" | grep -q 'Tests.*failed'; then bad; echo "$out" | tail -20 | sed 's/^/      /'; else ok; fi

  run "detector tests" bash scripts/novel-seams.test.sh
  run "prompt transform tests" bash scripts/novel-prompts.test.sh

  hdr "3. Re-anchor"
  if [[ $status -eq 0 ]]; then
    cat <<EOF
  Everything survived. Now move the anchor:

      export NOVEL_ANCHOR_TAG=<newtag>          # and update the default in
                                                # scripts/novel-seams.js,
                                                # scripts/novel-rebase.sh,
                                                # build/novel/*.json
      node scripts/novel-seams.js snapshot
      bash scripts/novel-guard.sh

  Commit the new manifest with the rebase, not separately — the manifest and
  the tree it describes have to move together or 'check' is lying.
EOF
  else
    cat <<EOF
  Do NOT re-snapshot yet. Fix the above first. The old manifest is the only
  thing that still knows what the tree is supposed to contain.
EOF
  fi
  return $status
}

case "${1:-}" in
  preflight) shift; cmd_preflight "$@" ;;
  postflight) cmd_postflight ;;
  *) echo "usage: novel-rebase.sh preflight <newtag> | postflight"; exit 2 ;;
esac
