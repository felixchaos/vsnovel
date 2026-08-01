#!/usr/bin/env bash
# Change-scope gate.
#
# Every upstream file we modify is a merge conflict we pay for on every rebase,
# forever. VS Code ships weekly; extensions/copilot alone saw ~5000 commits in
# twelve months. The plan's whole viability rests on our changes living in new
# directories, so this is enforced mechanically rather than left to discipline.
#
# Exits non-zero if the working tree touches anything outside the allowlist.
#
#   scripts/novel-guard.sh            # check against the anchor tag
#   scripts/novel-guard.sh --verbose  # also list the allowed changes
#
# Run before every commit, after every agent-assisted edit, and in CI.

set -uo pipefail

ANCHOR="${NOVEL_ANCHOR_TAG:-1.129.1}"
VERBOSE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1

cd "$(dirname "$0")/.." || exit 2

if ! git rev-parse --verify "$ANCHOR" >/dev/null 2>&1; then
  echo "novel-guard: anchor tag '$ANCHOR' not found. Set NOVEL_ANCHOR_TAG after rebasing." >&2
  exit 2
fi

# Directories we own outright. Anything here is ours; no rebase cost.
ALLOWED_DIRS=(
  "extensions/novel-agent/"
  "extensions/novel-lang-zh/"
  "patches/"
  "scripts/novel-"
  "build/novel/"
)

# Upstream files we are permitted to modify, each with the reason it could not
# be done in a new file. Adding a line here is a deliberate decision that costs
# rebase effort — it is not a formality.
#
# extensions/copilot is edited in place on purpose. The product requirement is
# that the agent a user finds in the Copilot sidebar *is* ours — not a second
# participant sitting beside it. Extensions are isolated, and
# CopilotExtensionApi (src/extension/api/vscode/extensionApi.ts:13) exposes only
# selectScope and getContextProviderAPI, so there is no way to inject prompts
# from outside. Modifying the extension is the only route to the required
# behavior.
#
# The rebase cost of that decision is proportional to *which* files we touch,
# not to the directory's total churn. Keeping this list short is the entire
# mitigation, so every entry needs a real justification.
#
# Format: path : justification
ALLOWED_FILES=(
  "product.json:branding, proposal grants, feature blacklist — data only, additive keys"
  "extensions/copilot/src/extension/extension/vscode-node/extension.ts:registers NovelAuthenticationProvider on the first line of activate(), before the DI container. It cannot be a contribution: \$ensureProvider on the main thread activates the extension that declares a provider id and waits for that activation, so a registration behind the activation blockers deadlocks against the auth service it is waiting on — measured as getAccounts() entering three times and never reaching ensureProvider. One import and one push; the alternative is no working sign-in"
  "extensions/copilot/src/extension/extension/vscode-node/contributions.ts:registers NovelAuthContrib. A pure insertion of one import and one array entry, in a file with 0 commits over the last six release tags — cheaper than the alternatives, which are patching the activation path or shipping a second extension, and the second is ruled out by CLAUDE.md"
  "extensions/copilot/src/platform/authentication/common/authentication.ts:authProviderId() is the single chokepoint every getSession in the extension routes through — one return value moves authentication off GitHub. Six call sites follow it unchanged. 1 commit across the last six release tags, and the alternative is editing all six"
  "extensions/copilot/src/extension/extension/vscode-node/services.ts:swaps the CAPI client for NovelCAPIClient, which redirects the pre-token account requests. Those cannot be moved by the token endpoints block because they happen before a token exists, and the URL getters live on a domain service the package holds privately. One import and one identifier changed; 7 commits over the last six release tags"
  "extensions/copilot/src/platform/endpoint/common/chatModelCapabilities.ts:adds isDeepSeekFamily and names it in the three edit-tool tables, and widens isKimiFamily to the bare `kimi` family and kimi-k3 (upstream names two model ids literally, so this product\u2019s K3 matched nothing and lost both the edit tables and the forced temperature=1/top_p=0.95 every Moonshot model 400s without) (modelSupportsReplaceString, modelSupportsMultiReplaceString, modelCanUseReplaceStringExclusively). A model absent from those tables gets insert_edit_into_file alone \u2014 the legacy code-mapper path that rewrites the entire chapter through a second speculative model call for a one-line change. The tables are a vendor list upstream extends the same way for kimi/minimax/gemini; one predicate and three appended disjuncts, which is the cheapest possible conflict on rebase. No external hook exists: agentIntent calls these functions directly, and the endpoint.supportedEditTools route the server could drive is gated on isExtensionContributed, which CAPI models are not"
  "extensions/copilot/src/platform/endpoint/node/chatEndpoint.ts:customizeCapiBody is the only point the chat-completions request body is finalized; upstream applies reasoningEffort on the Messages/Responses paths but not here, so a chat-completions model that declares reasoning_effort levels (DeepSeek V4) shows the control but never sends it. One additive block, guarded by supportsReasoningEffort, that only fills the field when unset. No external hook exists — customizeCapiBody is a method on the shared ChatEndpoint, not reachable from src/novel/"
  "extensions/copilot/tsconfig.json:aliases @vscode/copilot-api to src/novel/vendor/copilotApi (proprietary, uninstalled — aliasing keeps forty-odd upstream import sites untouched), and excludes src/extension/chatSessions from compilation, plus the two tests of that subtree that live outside it (parseAttachments.spec.ts, e2e/cli.stest.ts) — an exclude does not stop an included file from importing across it. The two proprietary session-type packages are no longer installed, so a fresh checkout cannot typecheck that subtree; excluding it is what lets the source stay in the tree (deleting it would conflict on every rebase) while the packages stay out of package.json"
  "extensions/copilot/script/postinstall.ts:skips the Copilot CLI staging pipeline and the Claude Code cli.js copy. Both unpack proprietary packages that are no longer in dependencies, and staging runs first, so with them absent this script throws before any other build step reports anything. Guarded by commenting out eight calls rather than deleting the functions, so they stay adjacent to their upstream versions"
  "extensions/copilot/test/simulationTests.ts:drops the one import of the Copilot CLI simulation test. TypeScript compiles an excluded file anyway when an included one imports it, so this single line is what pulled all of src/extension/chatSessions back into the program — 56 errors on a fresh install, every one about a package we no longer depend on"
  "extensions/copilot/.esbuild.mts:aliases @vscode/copilot-api to our implementation on the shared base options so every bundle resolves it, and drops the two chatSessions bundle entry points. They are built independently of the extension graph, so unregistering the contribution alone would still pull @github/copilot into the output"
  "extensions/copilot/src/extension/test/node/services.ts:stops wiring Claude Code services into the test container. The session type is unregistered and its package uninstalled, so the wiring would not compile"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/config.ts:turns on markdown and plaintext in the github.copilot.enable default. Upstream ships both off, which means no inline completion in the only two file types this product serves. This table is the second of two declarations of that default — its own comment says it mirrors package.json, and nothing enforces that, so changing only the manifest leaves this copy refusing for every caller that reads the default rather than the setting. One line; NES reads the same key and is covered by it"
  "extensions/copilot/src/extension/byok/vscode-node/anthropicProvider.ts:pins the native Anthropic BYOK client to baseURL https://api.anthropic.com. Without an explicit baseURL the @anthropic-ai/sdk falls back to process.env.ANTHROPIC_BASE_URL, so a user who exports that to a relay (routine for the claude CLI in CN) has their real sk-ant key silently forwarded to the relay and rejected with a foreign-language 401. Two client constructions plus one constant; the alternative — telling every such user to unset a var they need for another tool — is not robust. Relay users use the Custom Endpoint provider"
  "extensions/copilot/src/extension/prompts/node/panel/binaryFileHexdump.tsx:returns early for a UTF-16 byte-order mark. The nul-byte heuristic below is git's and is right for source code, but every UTF-16 character carries a zero byte, so a chapter saved by Windows Notepad's \"Unicode\" option is classified as binary and answered with a hex dump. This is the single gate both the read-file tool and file attachments pass through, and it is where the raw bytes exist — the normal text path reads through VS Code's document service, which decodes the mark correctly. Three lines and one import into src/novel/io/"
  "extensions/copilot/src/extension/xtab/common/inlineSuggestion.ts:accepts a CJK punctuation tail after the cursor. The upstream class is the complete set of closers for code and holds no CJK character, so a cursor before a full-width period or a closing 」 counts as mid-line and suppresses ghost text — the two commonest places an author writing Chinese or Japanese puts the caret. Added as an alternative so the upstream expression stays byte-identical; the audit's other option, making the check always pass, would show ghost text inside arbitrary prose. One clause and one import into src/novel/completions/"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/ghostText/ghostTextStrategy.ts:skips the after-accept override for prose. Accepting a completion replaces the server strategy with one capped at one line, twenty tokens and a stop at the first blank line, so for a manuscript the assistant goes quiet the moment the author signals they want more. Markdown and plaintext otherwise reach BlockMode.Server with no client-side trimming, which is the best path available to them (limitation N-09) and is exactly what this branch takes away. One condition, guarded by isProseLanguage, so code keeps the brake"
  "extensions/copilot/src/extension/tools/common/toolNames.ts:adds NovelCheck to both name enums and to the category table. The contributed name and the internal one are paired by enum *key* at module load, so a tool declared in package.json without an entry here is silently never resolved. Three lines, purely additive"
  "extensions/copilot/src/extension/tools/node/allTools.ts:imports the manuscript checker. Tool registration happens as a side effect of import, so a tool file nothing imports is absent with no error anywhere. One line"
  "extensions/copilot/src/platform/chat/common/commonTypes.ts:two messages shown verbatim to the author. The off-topic one told them their novel was not a programming question; the length one told them to rephrase, when hitting the limit part-way through a scene calls for continuing instead. Neither lives in a prompt directory, which is why the prompt lint gate never saw them — it now scans the whole extension for this class of string"
  "extensions/copilot/src/extension/extension/vscode/services.ts:also carries the conversation-wide rejectionMessage, which named the wrong product. Already on this list for the CAPI client swap"
  "extensions/copilot/src/lib/node/chatLibMain.ts:the second copy of that rejection message. Two copies, no shared constant — which is exactly why the gate scans rather than checks one file"
  # NOT currently modified, and should not be. This entry once read
  # 'excludedExtensions list', which reads as an instruction to remove
  # 'copilot' from it so the extension gets packaged. That would be wrong and
  # would package it twice: the exclusion keeps it out of the *generic*
  # extension stream because a *dedicated* one already compiles it from source
  # (packageCopilotExtensionStream, wired into the real package task at
  # gulpfile.vscode.ts:696 and :707). Kept listed so the permission exists if a
  # future need appears, with the reason it has not been used.
  "src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts:one default value — extensions.verifySignature goes false. The signatures it checks are Microsoft's, issued through a marketplace whose terms restrict it to official VS Code builds and which this paid product therefore cannot use. Against Open VSX every install fails with \"Signature verification was not executed\", which kills the extension pane entirely — including the official Chinese language pack. Not a security control here, just a broken one; the setting itself stays so a signing gallery can re-enable it"
  "src/vs/platform/extensionManagement/node/extensionManagementService.ts:one fallback value. Signature verification defaults off when the setting is unset. The declared default in the workbench contribution is not sufficient — --install-extension runs without a workbench, so the setting reads undefined and this line is what decides. Needed because no gallery this product can legally reach signs its extensions"
  "src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.contribution.ts:one default value. The experimental onboarding overlay goes off. It greets a first-time user with \"Welcome to VS Code / Sign in to use GitHub Copilot\" and four third-party sign-in buttons, none of them this product's. Its provider id is hardcoded to github, and using it leaves the account menu signed in while the chat panel is not"
  "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts:one default value. security.workspace.trust.enabled goes false. Workspace Trust guards a folder that can execute code — tasks, debug configs, extensions that auto-run; a folder of chapters executes nothing, so here it protects nothing while greeting a first-time author with \"Restricted Mode is intended for safe code browsing\" over their own manuscript and leaving a padlock in the status bar. It cannot be moved into an extension's configurationDefaults: the property is APPLICATION-scoped, and configurationExtensionPoint.ts accepts defaults only for machine-overridable, window, resource and language-overridable scopes — anything else is dropped with a warning, so the override would silently do nothing. The --disable-workspace-trust launch flag is not cheaper either, it is worse: it removes the setting instead of changing it, so a user who does open code here could never turn the protection back on. One line and a marker comment, in a block that one commit has touched in twenty-four months — and that commit left this line alone"
  "src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts:one early return. Core disables the builtin chat extension on a fresh profile until chat setup completes, and the setup flow is meant to re-enable it. Here that is circular — the authentication provider lives inside that extension, so sign-in needs it running and it only runs after sign-in. The packaged build shipped with chat, completions and sign-in all silently absent because of it"
  "build/.moduleignore:appended entries only. Strips packages the built bundle never requires — the telemetry SDK esbuild already inlined, and sharp, whose only caller is the vision path that no model in the catalog enables. 125MB on darwin-arm64. Verify with a zero require( count in dist/extension.js before adding a line"
  "build/lib/copilot.ts:one throw becomes a return. prepareBuiltInCopilotRipgrepShim stages the Copilot CLI's ripgrep out of @github/copilot, which is proprietary and deliberately not installed. Its absence is the intended state, but the step treated it as fatal and failed the whole package build on its final action, naming a path instead of a reason"
  "build/lib/extensions.ts:no change needed — see the note above before touching this"
  "build/lib/electron.ts:hardcoded Microsoft bundle metadata"
  "src/vs/workbench/common/views.ts:view-container chokepoint, ~10 lines"
  "src/vs/platform/actions/common/actions.ts:menu chokepoint, ~10 lines"
  "src/vs/platform/keybinding/common/keybindingsRegistry.ts:keybinding chokepoint, ~10 lines"

  # PromptRegistry resolves one prompt per model, so registering another
  # resolver would replace the per-family tuning we want to keep. These two
  # files hold the shared classes that every family's unset slots fall back to
  # (promptRegistry.ts:105-106), so editing them reaches all models while
  # leaving every per-family SystemPrompt untouched. Both now delegate to
  # src/novel/prompts/novelRules.tsx and are a few lines each.
  "extensions/copilot/src/extension/prompts/node/panel/customInstructions.tsx:one default string. It introduces the author's own .github/copilot-instructions.md to the model, which is where voice and style live in this product — style is per-work and cannot go in the shipped prompt. Calling it 'coding instructions' invites the model to apply a style guide to generated code and nothing else"
  "extensions/copilot/src/extension/prompts/node/panel/panelChatBasePrompt.tsx:identity sentence only, reachable through genericPanelIntentInvocation"
  "extensions/copilot/src/extension/prompts/node/base/safetyRules.tsx:shared safety slot — drops the software-engineering scope clause"
  "extensions/copilot/src/extension/prompts/node/base/copilotIdentity.tsx:shared identity slot — writing assistant, not coding assistant"

  # The inline completion pipeline sends no system message, so none of its
  # behaviour can be reached by editing prompts. Stop sequences, temperature and
  # the output budget are constants, and the four files below are where they are
  # chosen or threaded. Each edit is a delegation to
  # src/novel/completions/proseSampling.ts guarded by isProseLanguage(), so code
  # completion keeps its existing behaviour exactly.
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/openai/openai.ts:stop/temperature/max_tokens branch for prose"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/openai/fetch.ts:threads languageId into the two sampling calls"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/ghostText/completionsFromNetwork.ts:threads languageId into the temperature call"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/prompt/prompt.ts:prompt budget is derived from the completion budget and must see the same language"
  # package.json and this file declare the same default; the extension asserts
  # at startup that they agree, so enabling prose completion needs both.
  "extensions/copilot/package.json:enables markdown/plaintext completion, and turns the six inline-completion commands' hardcoded \"GitHub Copilot\" category and their titles into %key% references. A manifest literal is unreachable by a language pack — extensionsScannerService only substitutes %key% — so these were the one class of branding the pack could not touch, and category is what the command palette prints in front of every one of them. The other 78 branded literals in this manifest are deliberately left alone: they belong to Copilot CLI, cloud agents and GitHub repository features this product does not ship, and renaming them would make a dead feature look native"
  "extensions/copilot/package.nls.json:the English side of those seven keys. Additive, at the end of the file, so a rebase sees an append rather than a conflict"
  "extensions/copilot/src/platform/configuration/common/configurationService.ts:code-side copy of the same default"
)

# New files under these prefixes are ours even though they live inside an
# upstream directory. A path that upstream does not have cannot conflict on
# rebase, so novel-specific code belongs here rather than inlined into existing
# files.
ALLOWED_NEW_UNDER=(
  "extensions/copilot/src/novel/"
  "extensions/copilot/src/extension/novel/"
)

# Upstream directories we modify as a class rather than file by file.
#
# Only one qualifies. Each model family inlines its own identity sentence inside
# its SystemPrompt — twenty-one files carry some variant of "you are a coding
# agent" — and PromptRegistry resolves one prompt per model, so there is no slot
# through which they can be reached. Listing them individually would be twenty-one
# entries expressing one decision.
#
# What keeps this honest is that the *content* rule lives elsewhere:
# src/novel/prompts/test/novelPromptLint.spec.ts scans these files and fails on
# any coding-scope or coding-identity phrasing. This entry permits the edits;
# that gate decides whether they are correct.
ALLOWED_MODIFY_UNDER=(
  "extensions/copilot/src/extension/prompts/node/agent/:per-family identity sentences, inlined and unreachable from the registry slots; plus imports in allAgentPrompts.ts registering the deepseek, grok and kimi families onto the shared writing prompt. deepseek has no upstream prompt and would fall through to the coding default; grok and kimi are claimed upstream by matchesModel predicates, so their imports must precede './xAIPrompts' and './kimiPrompts' to win the registry's first-registered-predicate race (asserted by grokPrompt.spec.ts / kimiPrompt.spec.ts)"
)

# Directories that must never be touched.
#
# contrib/chat is the hottest area in the repo: ~6700 commits in twelve months,
# 55% of all workbench churn — and nothing we need requires editing it, because
# the chat UI is consumed through extension APIs rather than modified.
FORBIDDEN_DIRS=(
  "src/vs/workbench/contrib/chat/"
)

changed="$(git diff --name-only "$ANCHOR" -- . ; git ls-files --others --exclude-standard)"
changed="$(printf '%s\n' "$changed" | sed '/^$/d' | sort -u)"

if [[ -z "$changed" ]]; then
  echo "novel-guard: no changes against $ANCHOR"
  exit 0
fi

violations=()
forbidden=()
allowed=()

while IFS= read -r f; do
  [[ -z "$f" ]] && continue

  hit_forbidden=0
  for d in "${FORBIDDEN_DIRS[@]}"; do
    if [[ "$f" == "$d"* ]]; then
      forbidden+=("$f")
      hit_forbidden=1
      break
    fi
  done
  [[ $hit_forbidden -eq 1 ]] && continue

  ok=0
  for d in "${ALLOWED_DIRS[@]}"; do
    [[ "$f" == "$d"* ]] && { ok=1; break; }
  done
  if [[ $ok -eq 0 ]]; then
    for d in "${ALLOWED_NEW_UNDER[@]}"; do
      [[ "$f" == "$d"* ]] && { ok=1; break; }
    done
  fi
  if [[ $ok -eq 0 ]]; then
    for entry in "${ALLOWED_MODIFY_UNDER[@]}"; do
      [[ "$f" == "${entry%%:*}"* ]] && { ok=1; break; }
    done
  fi
  if [[ $ok -eq 0 ]]; then
    for entry in "${ALLOWED_FILES[@]}"; do
      [[ "$f" == "${entry%%:*}" ]] && { ok=1; break; }
    done
  fi

  if [[ $ok -eq 1 ]]; then
    allowed+=("$f")
  else
    violations+=("$f")
  fi
done <<< "$changed"

status=0

if [[ ${#forbidden[@]} -gt 0 ]]; then
  echo
  echo "novel-guard: FORBIDDEN — these paths must never be modified:"
  for f in "${forbidden[@]}"; do echo "    $f"; done
  echo
  echo "  contrib/chat is ~55% of workbench churn; extensions/copilot ~5000 commits/year."
  echo "  The chat UI is consumed through extension APIs; nothing here needs"
  echo "  editing. Put the change in extensions/copilot/ instead."
  status=1
fi

if [[ ${#violations[@]} -gt 0 ]]; then
  echo
  echo "novel-guard: OUT OF SCOPE — upstream files not on the allowlist:"
  for f in "${violations[@]}"; do echo "    $f"; done
  echo
  echo "  Each of these becomes a rebase conflict forever. Either:"
  echo "    - move it into extensions/copilot/src/novel/ (preferred — a path"
  echo "      upstream does not have cannot conflict), or"
  echo "    - add the file to ALLOWED_FILES here with a justification, which is"
  echo "      a deliberate decision to pay that cost on every rebase."
  status=1
fi

if [[ $VERBOSE -eq 1 && ${#allowed[@]} -gt 0 ]]; then
  echo
  echo "novel-guard: in scope (${#allowed[@]} files):"
  for f in "${allowed[@]}"; do echo "    $f"; done
fi

# --- API proposal declarations must agree -------------------------------------
#
# product.json OVERRIDES package.json rather than merging with it
# (extensionsProposedApi.ts:79-101). A proposal declared in only one of the two
# is dropped, and the failure is invisible in development: extension-development
# mode adds the missing proposals back with a warning, so the extension works on
# this machine and loses the capability once packaged.
#
# Compare them here instead of discovering it after a build.
check_proposal_sync() {
  local ext_dir ext_id pkg prod
  local mismatch=0

  for ext_dir in extensions/novel-*/; do
    [[ -f "${ext_dir}package.json" ]] || continue

    ext_id="$(node -p "
      const p = require('./${ext_dir}package.json');
      p.publisher && p.name ? p.publisher + '.' + p.name : ''
    " 2>/dev/null)"
    [[ -z "$ext_id" ]] && continue

    pkg="$(node -p "
      JSON.stringify((require('./${ext_dir}package.json').enabledApiProposals || []).slice().sort())
    " 2>/dev/null)"
    prod="$(node -p "
      const m = require('./product.json').extensionEnabledApiProposals || {};
      JSON.stringify((m['${ext_id}'] || []).slice().sort())
    " 2>/dev/null)"

    # An extension declaring no proposals needs no product.json entry.
    [[ "$pkg" == "[]" && "$prod" == "[]" ]] && continue

    if [[ "$pkg" != "$prod" ]]; then
      echo
      echo "novel-guard: PROPOSAL MISMATCH — $ext_id"
      echo "    ${ext_dir}package.json : $pkg"
      echo "    product.json           : $prod"
      echo
      echo "  product.json wins and does not merge. Whatever is missing there is"
      echo "  dropped at runtime — silently, and only once packaged."
      mismatch=1
    fi
  done

  return $mismatch
}

if ! check_proposal_sync; then
  status=1
fi

# --- The work must be committed ------------------------------------------------
#
# `git rebase --onto` replays COMMITS. Uncommitted edits are not replayed, they
# are carried across as working-tree state and silently discarded by any
# checkout, reset or clean. The guard used to pass identically whether the work
# was committed on the anchor or sitting unstaged, which is the one state in
# which every protection here is worthless.
check_committed() {
  local head anchor_commit dirty
  head="$(git rev-parse HEAD)"
  anchor_commit="$(git rev-parse "$ANCHOR^{commit}")"

  if [[ "$head" == "$anchor_commit" ]] && [[ -n "$changed" ]]; then
    echo
    echo "novel-guard: UNCOMMITTED — HEAD is exactly $ANCHOR but the tree has changes."
    echo
    echo "  There is nothing for 'git rebase --onto' to replay. A stray"
    echo "  'git checkout -- .' or 'git clean -fd' destroys all of it, including"
    echo "  untracked files under extensions/copilot/src/novel/."
    echo "  Commit onto the branch before doing anything else."
    return 1
  fi

  if ! git merge-base --is-ancestor "$anchor_commit" HEAD; then
    echo
    echo "novel-guard: DETACHED — HEAD does not descend from $ANCHOR."
    echo "  Every path check below is measured against the wrong baseline."
    return 1
  fi

  dirty="$(git status --porcelain --untracked-files=no)"
  if [[ -n "$dirty" ]] && [[ "${NOVEL_ALLOW_DIRTY:-0}" != "1" ]]; then
    echo
    echo "novel-guard: DIRTY — tracked files have uncommitted edits."
    echo "  Rebase-day checks read committed state. Commit or stash first,"
    echo "  or set NOVEL_ALLOW_DIRTY=1 for a mid-work check."
    return 1
  fi
  return 0
}

if ! check_committed; then
  status=1
fi

# --- Every upstream edit must carry a marker -----------------------------------
#
# A marker is what makes an edit findable by a human reading the file six months
# from now, and it is what a rebase conflict resolution is checked against. An
# unmarked edit in an upstream file is indistinguishable from upstream's own
# code once it has been through one merge.
check_markers() {
  local f mismatch=0
  for f in "${allowed[@]}"; do
    # Ours outright — no marker needed.
    case "$f" in
      extensions/novel-*|patches/*|scripts/novel-*|build/novel/*) continue ;;
      extensions/copilot/src/novel/*|extensions/copilot/src/extension/novel/*) continue ;;
    esac
    # Only modified upstream files need one; new files under our prefixes do not.
    git cat-file -e "$ANCHOR:$f" 2>/dev/null || continue
    [[ -f "$f" ]] || continue
    # JSON has no comments; data files are covered by build/novel/data-seams.json.
    case "$f" in *.json) continue ;; esac

    if ! grep -q 'NOVEL-BUILDER' "$f"; then
      if [[ $mismatch -eq 0 ]]; then
        echo
        echo "novel-guard: UNMARKED — upstream files edited with no NOVEL-BUILDER comment:"
      fi
      echo "    $f"
      mismatch=1
    fi
  done
  if [[ $mismatch -eq 1 ]]; then
    echo
    echo "  Add a '// NOVEL-BUILDER: <why>' line at each edit. On rebase day this"
    echo "  is how a conflict hunk is recognised as ours rather than upstream's."
  fi
  return $mismatch
}

if ! check_markers; then
  status=1
fi

# --- Every upstream edit must be recorded in the seam manifest -----------------
#
# The marker check above is for humans reading a conflict. This one is for the
# machine: novel-seams.js records, per edit, the upstream text that edit was
# written against, and re-checks it before a rebase. An edit missing from that
# manifest is checked against nothing, and the pre-rebase run says it is safe.
#
# Kept here rather than left to a habit because the failure is silent in both
# directions — nothing about the build or the tests changes when an edit stops
# being protected.
check_seams() {
  command -v node >/dev/null 2>&1 || {
    echo
    echo "novel-guard: node is not on PATH, so the seam manifest was not checked."
    echo "  Run 'node scripts/novel-seams.js check' before relying on this result."
    return 0
  }
  node scripts/novel-seams.js check || return 1
  return 0
}

if ! check_seams; then
  status=1
fi

if [[ $status -eq 0 ]]; then
  echo "novel-guard: OK — ${#allowed[@]} changed files, all in scope (anchor $ANCHOR)"
fi

exit $status
