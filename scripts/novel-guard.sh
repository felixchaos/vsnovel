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

ANCHOR="${NOVEL_ANCHOR_TAG:-1.134.0-release}"
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
  "extensions/copilot/src/extension/extension/vscode-node/contributions.ts:registers NovelAuthContrib and GrokAgentContribution (the ACP session that hosts xAI\u2019s own grok CLI). A pure insertion of one import and one array entry, in a file with 0 commits over the last six release tags — cheaper than the alternatives, which are patching the activation path or shipping a second extension, and the second is ruled out by CLAUDE.md"
  "extensions/copilot/src/platform/authentication/common/authentication.ts:authProviderId() is the single chokepoint every getSession in the extension routes through — one return value moves authentication off GitHub. Six call sites follow it unchanged. 1 commit across the last six release tags, and the alternative is editing all six"
  "extensions/copilot/src/extension/extension/vscode-node/services.ts:swaps the CAPI client for NovelCAPIClient, which redirects the pre-token account requests. Those cannot be moved by the token endpoints block because they happen before a token exists, and the URL getters live on a domain service the package holds privately. One import and one identifier changed; 7 commits over the last six release tags"
  "extensions/copilot/src/extension/prompt/node/chatMLFetcher.ts:the 5xx branch renders \`Server error: <status>\` and throws the response body away. Our gateway classifies every upstream failure and writes a sentence the author can act on \u2014 an overloaded model reads as \u300cthe model service is temporarily unavailable; try again shortly\u300d, not as our outage \u2014 and that sentence never reached the screen. One expression, preferring the already-parsed jsonData.message and keeping the status text as the fallback. The alternative was answering 503 instead of 502 to reach the branch above, which passes the body through but relabels an upstream capacity failure as a rate limit \u2014 the exact wording we removed from the server for being misleading"
  "resources/win32/inno-*.bmp:the Inno wizard artwork, 7 sizes each of the banner and the header mark. product.json cannot reach them \u2014 code.iss names the files directly \u2014 so the installer showed the upstream logo on every page while the app it installed showed ours. Rendered from resources/win32/code.ico at upstream\u2019s exact dimensions. Binary; a rebase either takes ours or upstream\u2019s, and there is nothing to merge"
  "build/win32/code.iss:AppPublisher, the three Publisher/Support/Updates URLs and the run-as-administrator warning are hardcoded to Microsoft and code.visualstudio.com. They are what Add/Remove Programs shows as the publisher and support link. OutputBaseFilename too, so the artifact in .build is not named VSCodeSetup. Six literals; the surrounding script is untouched"
  "build/win32/i18n/messages.*.isl:UpdatingVisualStudioCode is the string the background updater paints while it swaps the install, in 13 languages, and it named Visual Studio Code in all of them. The key is left alone \u2014 inno_updater.exe looks it up by name \u2014 and only the product name inside the value changes"
  "build/lib/electron.ts:companyName and copyright in the Electron packaging config. Together with the rcedit block in gulpfile.vscode.ts these are what Windows shows under Properties > Details; both said Microsoft Corporation. Two string literals"
  "build/gulpfile.vscode.ts:the rcedit version-string block writes CompanyName and LegalCopyright into every packaged exe, hardcoded to Microsoft. Two literals in a block that otherwise reads its values from product.json"
  "build/gulpfile.vscode.win32.ts:only defines the Appx package when win32ContextMenu is configured. Without the guard code.iss\u2019s #ifdef AppxPackageName block packages appx/code_<arch>.appx, which this fork never builds, and ISCC fails with a file-not-found. One condition"
  "src/vs/workbench/browser/media/code-icon.svg:the mark in the title bar, at #167abf. Windows and Linux draw it; macOS uses the native title bar and has no such slot, which is why it survived every check done on a Mac. Replaced wholesale with this product\u2019s mark at the same viewBox"
  "resources/win32/code.ico:the Windows app icon"
  "resources/darwin/code.icns:the macOS app icon"
  "resources/vsnovel/icon.svg:the source mark the two icons and the installer artwork are rendered from. New file; upstream has no such path and the conflict cost is zero"
  "README.md:the fork\u2019s own readme"
  "README.zh.md:its Chinese translation. New file; zero conflict cost"
  "NOTICE.md:attribution for the upstream projects, which the MIT License requires. New file; zero conflict cost"
  "NOTICE.zh.md:its Chinese translation. New file; zero conflict cost"
  ".github/workflows/release.yml:the tag-triggered pipeline that builds, signs and publishes both platforms. New file; VS Code\u2019s own workflows are pruned from the export rather than edited, so this cannot collide"
  ".github/workflows/release-windows.yml:a manual Windows-only build for checks that do not warrant cutting a release. New file; zero conflict cost"
  "build/darwin-sign.mjs:Developer ID signing, notarisation and stapling for the macOS artifact. New file; zero conflict cost"
  "update-server/*:the update manifest generator and the Cloudflare Worker that serves it. New directory; zero conflict cost"
  "scripts/vsnovel-release.sh:the older manual publish path, superseded by release.yml but kept for a hand-cut release. New file; zero conflict cost"
  "extensions/copilot/src/extension/byok/vscode-node/xAIProvider.ts:resolveModelCapabilities hands every Grok 4+ a hardcoded 120K in and 120K out. xAI documents 500K for 4.5 and 4.6 and 1M for 4.3 and the 4.20 builds, so an author with their own key silently lost most of the window they pay for \u2014 a context window that is too small truncates rather than errors, so nothing surfaces it. One early return that prefers the published table, which is shared with the relay vendor so the two paths cannot drift; upstream\u2019s heuristic is left intact underneath for ids xAI has not published. vision still comes from the API response, which is better than anything we could record"
  "scripts/novel-manifest.test.sh:tests the update manifest generator. Lives beside the other novel-*.test.sh rather than under update-server/ because that directory has no test runner and this needs none \u2014 it is five assertions on the JSON shape. New file; upstream has no such path and the conflict cost is zero"
  "scripts/vsnovel-sync.sh:pushes this tree to the public repo a release is built from. A new file in a directory upstream also has, so it is listed here rather than under src/novel/ \u2014 it has to live beside the other novel-* scripts to be findable, and it cannot live in the extension because it operates on the repository. Never touched by upstream; the conflict cost is zero"
  "extensions/copilot/src/extension/prompt/node/test/chatMLFetcherRetry.spec.ts:covers the finish-reason fall-through in chatMLFetcher.ts, which is already on this list. The tests live here rather than in a new file because the harness they need \u2014 the fetcher, the mock endpoint, the queued responses \u2014 is local to this spec and not exported. createMockEndpoint gains one optional argument so a test can name the finish reason and the text; without it every completion the stub yields is hardcoded to 'stop', which is why upstream's own tests never reached the branch. Two additive edits and one nested describe"
  "extensions/copilot/src/platform/endpoint/common/chatModelCapabilities.ts:adds isDeepSeekFamily and names it in the three edit-tool tables, and widens isKimiFamily to the bare \`kimi\` family and kimi-k3 (upstream names two model ids literally, so this product\u2019s K3 matched nothing and lost both the edit tables and the forced temperature=1/top_p=0.95 every Moonshot model 400s without) (modelSupportsReplaceString, modelSupportsMultiReplaceString, modelCanUseReplaceStringExclusively). A model absent from those tables gets insert_edit_into_file alone \u2014 the legacy code-mapper path that rewrites the entire chapter through a second speculative model call for a one-line change. The tables are a vendor list upstream extends the same way for kimi/minimax/gemini; one predicate and three appended disjuncts, which is the cheapest possible conflict on rebase. No external hook exists: agentIntent calls these functions directly, and the endpoint.supportedEditTools route the server could drive is gated on isExtensionContributed, which CAPI models are not"
  "extensions/copilot/src/platform/endpoint/node/chatEndpoint.ts:customizeCapiBody is the only point the chat-completions request body is finalized; upstream applies reasoningEffort on the Messages/Responses paths but not here, so a chat-completions model that declares reasoning_effort levels (DeepSeek V4) shows the control but never sends it. One additive block, guarded by supportsReasoningEffort, that only fills the field when unset. No external hook exists — customizeCapiBody is a method on the shared ChatEndpoint, not reachable from src/novel/"
  "extensions/copilot/tsconfig.json:aliases @vscode/copilot-api to src/novel/vendor/copilotApi (proprietary, uninstalled — aliasing keeps forty-odd upstream import sites untouched), and excludes src/extension/chatSessions from compilation, plus the two tests of that subtree that live outside it (parseAttachments.spec.ts, e2e/cli.stest.ts) — an exclude does not stop an included file from importing across it. The two proprietary session-type packages are no longer installed, so a fresh checkout cannot typecheck that subtree; excluding it is what lets the source stay in the tree (deleting it would conflict on every rebase) while the packages stay out of package.json"
  "extensions/copilot/script/postinstall.ts:skips the Copilot CLI staging pipeline and the Claude Code cli.js copy. Both unpack proprietary packages that are no longer in dependencies, and staging runs first, so with them absent this script throws before any other build step reports anything. Guarded by commenting out eight calls rather than deleting the functions, so they stay adjacent to their upstream versions"
  "extensions/copilot/test/simulationTests.ts:drops the one import of the Copilot CLI simulation test. TypeScript compiles an excluded file anyway when an included one imports it, so this single line is what pulled all of src/extension/chatSessions back into the program — 56 errors on a fresh install, every one about a package we no longer depend on"
  "extensions/copilot/.esbuild.mts:aliases @vscode/copilot-api to our implementation on the shared base options so every bundle resolves it, and drops the two chatSessions bundle entry points. They are built independently of the extension graph, so unregistering the contribution alone would still pull @github/copilot into the output"
  "extensions/copilot/src/extension/test/node/services.ts:stops wiring Claude Code services into the test container. The session type is unregistered and its package uninstalled, so the wiring would not compile"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/config.ts:turns on markdown and plaintext in the github.copilot.enable default. Upstream ships both off, which means no inline completion in the only two file types this product serves. This table is the second of two declarations of that default — its own comment says it mirrors package.json, and nothing enforces that, so changing only the manifest leaves this copy refusing for every caller that reads the default rather than the setting. One line; NES reads the same key and is covered by it"
  "extensions/copilot/src/extension/byok/vscode-node/byokContribution.ts:registers the five open-weight vendors (DeepSeek, Kimi, Zhipu GLM, Qwen, MiniMax) whose keys this product's authors actually hold. Upstream ships providers for the vendors Copilot cares about, and its known-models list is fetched from main.vscode-cdn.net, so none of these will ever appear there. Without them the only route to a DeepSeek key is Custom Endpoint, whose form asks a novelist for maxInputTokens, maxOutputTokens and toolCalling per model — a form that shipped to one author and produced an unreadable 401. One import and one four-line loop appended to _buildProviders; the provider classes themselves are in src/novel/byok/. No external hook exists: _buildProviders is private and the registration it feeds is keyed on ids the contribution owns."
  "extensions/copilot/src/extension/byok/vscode-node/anthropicProvider.ts:pins the native Anthropic BYOK client to baseURL https://api.anthropic.com. Without an explicit baseURL the @anthropic-ai/sdk falls back to process.env.ANTHROPIC_BASE_URL, so a user who exports that to a relay (routine for the claude CLI in CN) has their real sk-ant key silently forwarded to the relay and rejected with a foreign-language 401. Two client constructions plus one constant; the alternative — telling every such user to unset a var they need for another tool — is not robust. Relay users use the Custom Endpoint provider"
  "extensions/copilot/src/extension/prompts/node/panel/binaryFileHexdump.tsx:returns early for a UTF-16 byte-order mark. The nul-byte heuristic below is git's and is right for source code, but every UTF-16 character carries a zero byte, so a chapter saved by Windows Notepad's \"Unicode\" option is classified as binary and answered with a hex dump. This is the single gate both the read-file tool and file attachments pass through, and it is where the raw bytes exist — the normal text path reads through VS Code's document service, which decodes the mark correctly. Three lines and one import into src/novel/io/"
  "extensions/copilot/src/extension/xtab/common/inlineSuggestion.ts:accepts a CJK punctuation tail after the cursor. The upstream class is the complete set of closers for code and holds no CJK character, so a cursor before a full-width period or a closing 」 counts as mid-line and suppresses ghost text — the two commonest places an author writing Chinese or Japanese puts the caret. Added as an alternative so the upstream expression stays byte-identical; the audit's other option, making the check always pass, would show ghost text inside arbitrary prose. One clause and one import into src/novel/completions/"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/ghostText/ghostTextStrategy.ts:skips the after-accept override for prose. Accepting a completion replaces the server strategy with one capped at one line, twenty tokens and a stop at the first blank line, so for a manuscript the assistant goes quiet the moment the author signals they want more. Markdown and plaintext otherwise reach BlockMode.Server with no client-side trimming, which is the best path available to them (limitation N-09) and is exactly what this branch takes away. One condition, guarded by isProseLanguage, so code keeps the brake"
  "extensions/copilot/src/extension/tools/common/toolNames.ts:adds NovelCheck to both name enums and to the category table. The contributed name and the internal one are paired by enum *key* at module load, so a tool declared in package.json without an entry here is silently never resolved. Three lines, purely additive"
  "extensions/copilot/src/extension/tools/node/allTools.ts:imports the manuscript checker. Tool registration happens as a side effect of import, so a tool file nothing imports is absent with no error anywhere. One line"
  "extensions/copilot/src/extension/tools/node/test/findTextInFilesTool.spec.tsx:one test for the no-match branch of the grep renderer. Upstream has none on that path, which is why the crossed channels shipped; it belongs beside the code it locks, not in src/novel/, because the assertion is about this tool's own return shape"
  "extensions/copilot/src/extension/tools/node/findTextInFilesTool.tsx:the no-match branch of the grep renderer had its two channels crossed. The paragraph written for the model — search.exclude, .gitignore, node_modules, includeIgnoredFiles — went into toolResultMessage, which is the label the author reads in the chat, while the model got an empty content array and therefore the literal string (empty) from <IfEmpty> in toolCalling.tsx. So the author was shown build-tool jargon about a manuscript folder and the model was never told the search returned nothing, which invites it to search again and print the paragraph again. grep is the default output format (getOutputFormat returns it for any value but 'tag'), so this is every fruitless search. The tag renderer next to it already routes both correctly; this now mirrors it. One branch and one helper, and a test — upstream has none on this path, which is how it shipped"
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
  "src/vs/platform/update/common/update.config.contribution.ts:one default value. update.enableWindowsBackgroundUpdates goes false. The background path installs into {app}\\_ and then has inno_updater rename the running exe aside, the new one into place, and roll back if that fails. All three renames can lose to a scanner holding a handle on a freshly written exe, and this product's Windows chain is unsigned end to end, so it is not a rare race \u2014 when it loses, the old exe is gone, the new one never lands, and the install directory is left with no executable at all: the shortcut reports the item was changed or moved and the editor cannot start to say anything. Seen on 1.129.1 -> 1.134.0. Off, the update goes to Ready and doQuitAndInstall runs the installer with /silent and no /update=, so IsBackgroundUpdate() is false, Inno installs into {app} directly and inno_updater never runs. Cannot move to an extension's configurationDefaults: APPLICATION-scoped properties are dropped there with only a warning, the same reason security.workspace.trust.enabled is on this list"
  "src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts:one early return. Core disables the builtin chat extension on a fresh profile until chat setup completes, and the setup flow is meant to re-enable it. Here that is circular — the authentication provider lives inside that extension, so sign-in needs it running and it only runs after sign-in. The packaged build shipped with chat, completions and sign-in all silently absent because of it"
  "build/.moduleignore:appended entries only. Strips packages the built bundle never requires — the telemetry SDK esbuild already inlined, and sharp, whose only caller is the vision path that no model in the catalog enables. 125MB on darwin-arm64. Verify with a zero require( count in dist/extension.js before adding a line"
  "build/lib/copilot.ts:one throw becomes a return. prepareBuiltInCopilotRipgrepShim stages the Copilot CLI's ripgrep out of @github/copilot, which is proprietary and deliberately not installed. Its absence is the intended state, but the step treated it as fatal and failed the whole package build on its final action, naming a path instead of a reason"
  "build/lib/extensions.ts:no change needed — see the note above before touching this"
  "build/lib/electron.ts:hardcoded Microsoft bundle metadata"
  "src/vs/workbench/common/views.ts:view-container chokepoint, ~10 lines"
  "src/vs/platform/actions/common/actions.ts:one early return in registerAction2, against a list of command ids this product withholds. registerAction2 is where one Action2 declaration becomes a command, a palette entry, a menu item and a keybinding, so withholding it here removes all four at once; there is no external hook, and a command already registered cannot be un-registered by a later contribution. The list currently holds the three Agents Window entry points (openAgentsWindow, openWorkspaceInAgentsWindow, chat.openSessionInAgentsWindow). That window is a second workbench under src/vs/sessions/ that hosts agent CLI sessions through copilotcli and claude-code harnesses; this product implements neither, so opening it runs a sign-in flow separate from the one the author already completed, fails it, and then reports that no models are available. Its own chokepoint, OPEN_AGENTS_WINDOW_PRECONDITION, is in src/vs/workbench/contrib/chat/, which this script forbids outright. The welcome-page banner needs no entry of its own: canShowAgentsBanner asks CommandsRegistry whether the command exists. One tip in chatTipCatalog.ts still renders a now-dead command: link; it is left alone rather than opening that directory"
  "src/vs/platform/keybinding/common/keybindingsRegistry.ts:keybinding chokepoint, ~10 lines"
  "src/vs/workbench/services/accounts/browser/defaultAccount.ts:resolveGitHubUrl is the single place the workbench turns a well-known account path into a URL, and every \"manage settings\", \"manage budget\" and \"upgrade\" entry goes through it \u2014 the chat status dashboard, the title-bar menu, the model picker, the sign-in dialog footer and onboarding. All five sent an author to github.com/settings/copilot/features, which for this product is a page about someone else's subscription; balance, usage and top-up live on our own account page. One helper and two early returns, keyed on the three known GitHubPaths so a path upstream adds later still resolves against github.com. There is no external hook, and four of the five callers are under contrib/chat, which this script forbids outright"
  "src/vs/base/common/product.ts:one optional field, defaultChatAgent.accountUrl \u2014 the address of this product's own account page, which the resolveGitHubUrl branch above reads. Optional so a build against upstream's product.json keeps upstream's behaviour exactly. Purely additive, in an interface upstream extends the same way"

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
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/prompt/components/recentEdits.tsx:drops the recent-edits block for prose. It renders a diff of the files the author touched last \u2014 for a manuscript, paragraphs of another chapter \u2014 immediately before the text at the caret, and the model continues that instead of the line being written. Measured on the real service, one character sheet ending in \u300c\u6837\u8c8c\uff1a\u8eab\u9ad8158cm\uff0c\u300d: with the block, 3 of 3 completions continued the chapter\u2019s scene; without it, 3 of 3 continued the field. One early return in the data callback, guarded by isProseLanguage, so code keeps the block it was written for"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/textDocumentManager.ts:getRelativePath slices the path out of a URI and never decodes it, so a non-ASCII path reaches the prompt as \`Path: %E8%AE%BE%E5%AE%9A/%E8%A7%92%E8%89%B2.md\`. That marker is the one line telling the model whether it is completing a chapter or a character sheet, and for a Chinese or Japanese manuscript it is the whole path. One call to percentDecode, the same helper the basename fallback in the very same function already uses"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/prompt/similarFiles/neighborFiles.ts:the same missed decode, in the sibling getRelativePath whose own basename branch already decodes. Its result is the headline on a similar-file snippet. One call"
  "extensions/copilot/src/extension/completions-core/vscode-node/lib/src/util/uri.ts:exports percentDecode so the two functions above can use it. The export keyword and a comment; no behaviour change"
  "extensions/copilot/src/platform/configuration/common/configurationService.ts:the code-side default for nextEditSuggestions.enabled, turned off. NES asks for a model whose name is hardcoded upstream (nes-callisto) and which this product\u2019s catalog does not have, so the feature only ever produced a 404 every few seconds with nothing on screen to explain it. It cannot be done in package.json alone: the config registry compares the two declarations at load and throws on a mismatch, which takes the whole extension down \u2014 measured, 11 spec files failed with \u300cdifferent in packageJson and in code\u300d. One boolean; the setting still exists for an author who wants it back"
  # package.json and this file declare the same default; the extension asserts
  # at startup that they agree, so enabling prose completion needs both.
  "extensions/copilot/package.json:declares the three tools this product adds (searchManuscript, novelCheck, lookUpReference \u2014 a tool that is not in the manifest is not offered to any model), enables markdown/plaintext completion, and turns the six inline-completion commands' hardcoded \"GitHub Copilot\" category and their titles into %key% references. A manifest literal is unreachable by a language pack — extensionsScannerService only substitutes %key% — so these were the one class of branding the pack could not touch, and category is what the command palette prints in front of every one of them. The other 78 branded literals in this manifest are deliberately left alone: they belong to Copilot CLI, cloud agents and GitHub repository features this product does not ship, and renaming them would make a dead feature look native. Also declares the \`grok\` chat-session type and the \`novel.grokPath\` setting. The session type needs \`canDelegate: true\` or core registers neither the agent nor the new-session command and the entry is simply absent from the picker with no error (chatSessions.contribution.ts:740)"
  "extensions/copilot/package.nls.json:the English side of those seven keys. Additive, at the end of the file, so a rebase sees an append rather than a conflict"
  "extensions/copilot/src/platform/configuration/common/configurationService.ts:code-side copy of the same default"
  "extensions/copilot/src/platform/configuration/vscode/configurationServiceImpl.ts:one optional chain in the telemetry config-property walk. \`this.config\` is scoped to the copilot prefix, so every \`novel.*\` setting this product contributes dereferences undefined and throws — and the throw is caught outside the loop, so one such key aborts the collection entirely and no configuration properties are ever gathered. Measured at 13,722 log lines in a single session, on \`novel.nameCheck\`, months before anyone looked. Upstream cannot hit this because all of its own keys are under the prefix"
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
  "extensions/copilot/src/extension/prompts/node/agent/:per-family prompt text rewritten for a novelist, inlined and unreachable from the registry slots; plus an additive slot on PromptRegistry (registerAdditionalInstructions) and its two render sites in agentPrompt.tsx. The slot exists because the registry resolves exactly one prompt per model, which is right for the per-family tunings but wrong for instructions that belong to every model equally — where the story bible lives, that a search must be told which chapter is being written. Expressing those through the existing slot meant replacing a family's tuning in order to add to it, which is what this product used to do for deepseek, grok and kimi and no longer does. One import in allAgentPrompts.ts registers the layer; order is irrelevant because nothing competes"
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
      # Unquoted on the right so the entry is a pattern, not a literal. Three
      # entries need it: the 14 Inno bitmaps, the 13 updater .isl files and the
      # update-server directory are each one decision, and spelling them out
      # file by file would put the same justification in the list 31 times —
      # which reads as 31 decisions and hides the one that was actually made.
      # Every other entry is a plain path and matches exactly as before.
      # shellcheck disable=SC2053
      [[ "$f" == ${entry%%:*} ]] && { ok=1; break; }
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
    # A marker has to be readable by a person to be worth anything. Binaries
    # cannot carry one at all, and prompt snapshots are generated output — 173
    # of them, regenerated wholesale whenever a prompt changes, so a marker
    # there would say nothing the prompt file does not already say. Demanding
    # one anyway is what made this check report 208 files and get ignored.
    case "$f" in
      *.bmp|*.ico|*.icns|*.png|*.jpg|*.gif|*.woff|*.woff2|*.ttf) continue ;;
      */__snapshots__/*) continue ;;
    esac

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
