#!/usr/bin/env bash
# Push this tree's state to the public repo a release is built from.
#
# Releases are cut by pushing a `v*` tag to felixchaos/vsnovel, which runs
# .github/workflows/release.yml. This script is the step before that: it makes
# the public repo match this one.
#
# It exists because the step used to be done by hand, from the *working tree*,
# with `git add -A; git write-tree; git reset`. That shipped uncommitted work
# and never asked for a commit, so by 2026-08-22 this branch was 295 files
# behind what was in production — content that existed only in two working
# copies, with no message anywhere saying why any of it was written. Rebasing
# would have meant resolving all of it blind.
#
# So: this exports HEAD, and refuses to run on a dirty tree. What ships is what
# is committed, and nothing else.
#
# Usage:
#   scripts/vsnovel-sync.sh              # sync and stop, so the diff can be read
#   scripts/vsnovel-sync.sh --push       # ... then commit and push main
#   scripts/vsnovel-sync.sh --push --tag v1.129.1-nvl.7
#
# With --push it reuses this repo's HEAD commit message; pass --message to
# override.

set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${VSNOVEL_REPO:-https://github.com/felixchaos/vsnovel.git}"
WORK="${VSNOVEL_SYNC_DIR:-${TMPDIR:-/tmp}/vsnovel-sync}"
PUSH=0
TAG=""
MESSAGE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --tag) TAG="${2:?--tag needs a value}"; shift 2 ;;
    --message) MESSAGE="${2:?--message needs a value}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- the gate --
#
# The whole point of the script. A dirty tree here means work that would ship
# without a commit, which is the failure this exists to prevent.
if [ -n "$(git status --porcelain)" ]; then
  echo "vsnovel-sync: the working tree has uncommitted changes." >&2
  echo >&2
  git status --short | head -20 >&2
  n=$(git status --porcelain | wc -l | tr -d ' ')
  [ "$n" -gt 20 ] && echo "  ... and $((n - 20)) more" >&2
  echo >&2
  echo "  Commit them first. Releases are built from what is pushed, and" >&2
  echo "  anything left uncommitted here ships anyway but is recorded nowhere." >&2
  exit 1
fi

HEAD_SHA="$(git rev-parse --short HEAD)"
echo "vsnovel-sync: exporting HEAD ($HEAD_SHA)"

rm -rf "$WORK"
mkdir -p "$WORK/stage"
git archive HEAD | tar -x -C "$WORK/stage"

# VS Code's own workflows would fire on every push to the public repo — dozens
# of pr-* runs and dependabot noise on a repo that only exists to build
# releases. Ours are the two that should run there.
find "$WORK/stage/.github/workflows" -name '*.yml' \
  ! -name 'release.yml' ! -name 'release-windows.yml' -delete

echo "vsnovel-sync: cloning $REPO"
git clone --depth 1 -q "$REPO" "$WORK/repo"
rsync -a --delete --exclude='.git/' "$WORK/stage/" "$WORK/repo/"

cd "$WORK/repo"

# `extensions/copilot/.gitattributes` puts `*.sqlite` through Git LFS, and the
# simulation cache holds ~96 of them. rsync overwrites the smudged files with
# byte-identical ones, and every single one then reads as modified. Restoring
# them is not cosmetic: without it the diff is unreadable and the commit carries
# a heap of large binaries that were never part of the change. `.config` is the
# same story for CRLF.
git checkout -- 'extensions/copilot/test/simulation/cache' '.config' 2>/dev/null || true

CHANGED="$(git status --porcelain | wc -l | tr -d ' ')"
echo
echo "vsnovel-sync: $CHANGED file(s) differ from the public repo"
git status --short
echo

if [ "$CHANGED" = "0" ]; then
  echo "vsnovel-sync: already in sync; nothing to push."
  exit 0
fi

if [ "$PUSH" != "1" ]; then
  echo "vsnovel-sync: stopping here. Read the diff above, then re-run with --push."
  echo "              working copy: $WORK/repo"
  exit 0
fi

if [ -z "$MESSAGE" ]; then
  MESSAGE="$(cd - >/dev/null && git log -1 --format=%B)"
fi

git add -A
printf '%s\n' "$MESSAGE" | git commit -q -F -
git push -q origin HEAD:main
echo "vsnovel-sync: pushed main"

if [ -n "$TAG" ]; then
  git tag "$TAG"
  git push origin "$TAG"
  echo "vsnovel-sync: pushed $TAG — release.yml is now building both platforms"
fi
