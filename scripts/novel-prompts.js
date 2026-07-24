#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 * VS Novel — prompt transformation, replayable.
 *
 * The copilot prompts were reframed from a coding agent to a writing agent by
 * hand. Doing that again by hand at every upstream update is how the reframing
 * ends up half-applied: upstream adds a model family, its prompt says "coding
 * agent", nobody notices, and one model silently behaves like the old product.
 *
 * So the transformation is declared in build/novel/prompt-rules.json and
 * replayed. `apply` is the easy half. The half that matters is `check`, which
 * answers the question a script cannot answer for itself:
 *
 *     WHAT DOES A HUMAN HAVE TO LOOK AT THIS TIME?
 *
 * Three things earn that answer, and each is silent otherwise:
 *
 *   STALE      a rule's source text is gone from upstream — reworded, moved,
 *              or deleted. The rule cannot be replayed and the reframing it
 *              performed is simply absent. `apply` would report zero
 *              replacements and exit 0.
 *   SPREAD     upstream added a prompt carrying text a rule already covers.
 *              `apply` handles it, but the surface grew and someone should
 *              know the new family exists.
 *   UNCLASSIFIED
 *              prompt text that reads as software-specific and is covered by
 *              no rule and no accepted-list entry. This is new upstream
 *              writing nobody has judged yet.
 *
 * Every software-flavoured sentence in the prompt tree must be in exactly one
 * of three states: transformed by a rule, listed in `accepted` with a reason,
 * or reported here. The ledger is the point — without it "we looked at this
 * already" is a memory, and memory does not survive six upstream updates.
 *
 *   scripts/novel-prompts.js apply           # replay the rules onto the tree
 *   scripts/novel-prompts.js check           # what needs a human, against HEAD
 *   scripts/novel-prompts.js check <tag>     # ... if we moved to <tag>
 *
 * Exit codes: 0 nothing needs a human · 1 something does · 2 usage error.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const RULES_PATH = path.join(REPO, 'build', 'novel', 'prompt-rules.json');
const PROMPT_ROOT = 'extensions/copilot/src/extension/prompts/node';

function git(args) {
	try {
		return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return null;
	}
}

function rules() {
	if (!fs.existsSync(RULES_PATH)) {
		console.error(`novel-prompts: no rules at ${path.relative(REPO, RULES_PATH)}`);
		process.exit(2);
	}
	return JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
}

/** Every prompt file, as it stands in the working tree. */
function promptFiles() {
	const out = [];
	const walk = dir => {
		for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
			const rel = `${dir}/${e.name}`;
			if (e.isDirectory()) { walk(rel); }
			else if (/\.tsx?$/.test(e.name) && !rel.includes('/test/')) { out.push(rel); }
		}
	};
	walk(PROMPT_ROOT);
	return out;
}

/** The same set at a given tag. */
function promptFilesAt(tag) {
	const raw = git(['ls-tree', '-r', '--name-only', tag, '--', PROMPT_ROOT]) || '';
	return raw.split('\n').filter(f => /\.tsx?$/.test(f) && !f.includes('/test/'));
}

const readAt = (tag, f) => git(['show', `${tag}:${f}`]);
const readNow = f => {
	const abs = path.join(REPO, f);
	return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};

/**
 * Put `marker` on its own line directly above each line holding `after`,
 * matching that line's indentation. Idempotent: a marker already there is left
 * alone, so `apply` can be run twice without stacking comments.
 */
function insertMarker(text, after, marker) {
	const target = after.trim();
	if (!target) { return text; }
	const lines = text.split('\n');
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const hit = lines[i].trim() === target || (target.length > 20 && lines[i].includes(target));
		if (hit && !(out[out.length - 1] || '').includes('NOVEL-BUILDER')) {
			out.push(/^\s*/.exec(lines[i])[0] + marker);
		}
		out.push(lines[i]);
	}
	return out.join('\n');
}

function countIn(text, needle) {
	if (!text || !needle) { return 0; }
	return text.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/**
 * Replay the rules — but only onto files each rule is recorded against.
 *
 * The scope limit is the whole safety story. Without it, a rule matching text
 * upstream happens to reuse elsewhere rewrites a prompt nobody decided to
 * rewrite. That is not hypothetical: the first run of this command reframed
 * editCodePrompt2.tsx and notebookInlinePrompt.tsx — the inline code-edit and
 * notebook prompts — because they share one sentence with the agent prompts.
 * Whether a notebook prompt should call itself a writing agent is a judgement,
 * and a find-and-replace is not entitled to make it.
 *
 * So a match outside the recorded set is reported by `check` as SPREAD and
 * transformed only once a person adds that file to the rule.
 */
function cmdApply(dryRun) {
	const spec = rules();
	let totalHits = 0;
	let skipped = 0;
	const perRule = new Map();
	const touched = new Set();

	for (const f of promptFiles()) {
		let text = readNow(f);
		if (text === null) { continue; }
		const before = text;
		for (const r of spec.rules) {
			const n = countIn(text, r.from);
			if (n === 0) { continue; }
			if (!r.files.includes(f)) { skipped += n; continue; }
			if (r.deleteLine) {
				// Replacing with the empty string leaves the line's indentation
				// behind, which renders as a stray blank line in the prompt. The
				// whole line goes.
				text = text.split('\n').filter(l => l.trim() !== r.from.trim()).join('\n');
			} else {
				text = text.split(r.from).join(r.to);
			}
			// The marker is part of the edit, not decoration: novel-guard fails a
			// build without one, and on rebase day it is what tells a person
			// resolving a conflict that the hunk is ours. Replaying the
			// substitution without it produces a file that differs from the
			// committed one and fails the gate.
			if (r.marker) { text = insertMarker(text, r.markerAnchor || r.to, r.marker); }
			perRule.set(r.id, (perRule.get(r.id) || 0) + n);
			totalHits += n;
			touched.add(f);
		}
		if (text !== before && !dryRun) { fs.writeFileSync(path.join(REPO, f), text); }
	}

	if (totalHits === 0) {
		console.log('novel-prompts: nothing to apply — every rule is already reflected in its recorded files.');
	} else {
		console.log(`novel-prompts: ${dryRun ? 'would apply' : 'applied'} ${totalHits} replacement(s) across ${touched.size} file(s)`);
		for (const [id, n] of [...perRule].sort((a, b) => b[1] - a[1])) {
			console.log(`    ${String(n).padStart(3)}x  ${id}`);
		}
	}
	if (skipped) {
		console.log(`\n  ${skipped} match(es) were left alone because they are in files no rule is scoped to.`);
		console.log('  Run `check` to see them. Widening a rule is a decision, not a side effect.');
	}
	return 0;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

function cmdCheck(tag) {
	const spec = rules();
	const target = tag || 'HEAD';
	if (tag && !git(['rev-parse', '--verify', tag])) {
		console.error(`novel-prompts: '${tag}' is not a known ref.`);
		return 2;
	}

	const manual = [];      // needs a human
	const notes = [];       // worth saying, not blocking

	// --- rules -------------------------------------------------------------
	const upstreamFiles = tag ? promptFilesAt(tag) : promptFilesAt(spec.anchor);
	const upstreamText = new Map();
	for (const f of upstreamFiles) { upstreamText.set(f, readAt(tag || spec.anchor, f)); }

	// Scanned for rule matches: upstream's files at the target tag, plus our own
	// tree. A prompt file that exists only on our branch still carries the old
	// framing if a rule text landed in it, and scanning upstream alone would
	// never look.
	const liveText = new Map();
	if (!tag) { for (const f of promptFiles()) { liveText.set(f, readNow(f)); } }

	for (const r of spec.rules) {
		let upstreamHits = 0;
		const foundIn = [];
		for (const [f, t] of upstreamText) {
			const n = countIn(t, r.from);
			if (n > 0) { upstreamHits += n; foundIn.push(f); }
		}
		for (const [f, t] of liveText) {
			if (foundIn.includes(f)) { continue; }
			if (countIn(t, r.from) > 0) { foundIn.push(f); }
		}

		if (upstreamHits === 0) {
			manual.push({
				kind: 'STALE',
				what: r.id,
				detail: `upstream no longer contains the text this rule replaces`,
				text: r.from.slice(0, 120),
				action: 'Find what upstream says now. If the sentence was reworded, update `from`. If the prompt was deleted, delete the rule. Do not leave it: a stale rule replays as a no-op and the reframing it did is gone.'
			});
			continue;
		}

		const recorded = new Set(r.files);
		const excluded = new Set(r.exclude || []);
		const extra = foundIn.filter(f => !recorded.has(f) && !excluded.has(f));
		const gone = [...recorded].filter(f => !foundIn.includes(f));
		if (extra.length) {
			// Not a note. An untransformed prompt carrying the old framing is a
			// model family still behaving like the old product, and the only
			// reason it is not already wrong is that nobody has looked. The
			// decision is binary and must be recorded either way: into `files`
			// to transform it, or into `exclude` with the reason it should keep
			// upstream's wording.
			manual.push({
				kind: 'SPREAD',
				what: r.id,
				detail: `matches ${extra.length} file(s) this rule is not scoped to: ${extra.map(f => f.split('/').pop()).join(', ')}`,
				action: 'Decide per file. Add it to the rule\'s `files` to transform it, or to `exclude` with the reason. `apply` will not touch it until you do.'
			});
		}
		if (gone.length && extra.length === 0) {
			notes.push({
				kind: 'NARROWED',
				what: r.id,
				detail: `no longer in: ${gone.map(f => f.split('/').pop()).join(', ')}`,
				action: 'Upstream dropped or reworked those prompts. Update `files`.'
			});
		}

		// Is it actually applied in our tree right now?
		if (!tag) {
			// Scoped to the rule's own files. Counting matches everywhere would
			// report a deliberately excluded file as unapplied work forever.
			let live = 0;
			for (const f of r.files) { live += countIn(readNow(f), r.from); }
			if (live > 0) {
				manual.push({
					kind: 'UNAPPLIED',
					what: r.id,
					detail: `${live} occurrence(s) of the untransformed text are in the tree`,
					text: r.from.slice(0, 120),
					action: 'Run `novel-prompts.js apply`.'
				});
			}
		}
	}

	// --- delegations -------------------------------------------------------
	for (const d of spec.delegations || []) {
		const text = tag ? readAt(tag, d.file) : readNow(d.file);
		if (text === null) {
			manual.push({
				kind: 'DELEGATION GONE',
				what: d.file.split('/').pop(),
				detail: 'the file no longer exists',
				action: `Find where upstream moved ${d.expect}'s host. This slot is shared by every model family; losing it silently un-reframes all of them.`
			});
			continue;
		}
		// At a candidate tag the file is upstream's, so it will not mention our
		// symbol — that is expected, not a failure. Only the live tree is asserted.
		if (!tag && !text.includes(d.expect)) {
			manual.push({
				kind: 'DELEGATION BROKEN',
				what: d.file.split('/').pop(),
				detail: `no longer delegates to ${d.expect}`,
				action: 'Restore the delegation. Every model family reads this slot.'
			});
		}
	}

	// --- unclassified prompt text -----------------------------------------
	// Short fragments are dropped deliberately. A rule whose `to` is the empty
	// string — a deletion — yields `""`, and `line.includes("")` is true for
	// every line, which silently disabled this entire check until a test that
	// planted an unjudged sentence failed to see it reported.
	const known = [
		...spec.rules.flatMap(r => [r.from, r.to]),
		...(spec.accepted || []).map(a => a.text)
	].map(t => (t || '').trim()).filter(t => t.length >= 24).map(t => t.slice(0, 60));
	const patterns = (spec.reviewPatterns || []).map(p => new RegExp(p, 'i'));

	// Scoped to prompts an author can actually reach. The excluded roots are
	// code-only features whose prompts correctly call themselves programming
	// assistants; the product gates the features that reach them, so their
	// wording has no user-visible effect and rewriting it is pure rebase cost.
	// The list is the one novelPromptLint.spec.ts already uses — one definition,
	// so the two cannot drift apart and disagree about what the agent is.
	const outOfScope = (spec.scanScope && spec.scanScope.outOfScope) || [];
	const inScope = f => !outOfScope.some(root => f === root || f.startsWith(root.replace(/\/?$/, '/')));
	const filesToScan = (tag ? upstreamFiles : [...new Set([...promptFiles(), ...upstreamFiles])]).filter(inScope);
	const unclassified = [];
	for (const f of filesToScan) {
		const text = tag ? upstreamText.get(f) : readNow(f);
		if (!text) { continue; }
		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const t = line.trim();
			// Only prompt text. Comments, imports and code are not sent to the model.
			if (!t || /^(\/\/|\/\*|\*|import |export |const |let |return |class |interface |type |@)/.test(t)) { continue; }
			if (t.includes('NOVEL-BUILDER') || t.startsWith('{/*')) { continue; }
			if (!patterns.some(p => p.test(t))) { continue; }
			if (known.some(k => t.includes(k))) { continue; }
			unclassified.push({ file: f, line: i + 1, text: t.slice(0, 150) });
		}
	}
	// A ratchet, not a tolerance. The backlog that existed when this scan first
	// worked is recorded as a ceiling; anything ABOVE it is new upstream writing
	// and fails immediately. The ceiling may only be lowered, and lowering it is
	// what triaging an item looks like. Without this the whole check would sit
	// red for weeks and stop being read, which is how a real regression hides
	// behind a familiar number.
	const ceiling = spec.unclassifiedCeiling === undefined ? 0 : spec.unclassifiedCeiling;
	const overBudget = unclassified.length > ceiling;
	for (const u of overBudget ? unclassified : []) {
		manual.push({
			kind: 'UNCLASSIFIED',
			what: `${u.file.split('/').pop()}:${u.line}`,
			detail: u.text,
			action: 'Judge it: transform it with a new rule, or record it in `accepted` with the reason it is harmless. Leaving it here means it gets re-reported every update.'
		});
	}

	if (!overBudget && unclassified.length) {
		notes.push({
			kind: 'BACKLOG',
			what: `${unclassified.length} unjudged sentence(s), ceiling ${ceiling}`,
			detail: 'Pre-existing. Not blocking, but the ceiling may only go down.',
			action: 'Triage some into `accepted` (with the reason) or into a rule, then lower `unclassifiedCeiling` by the same amount.'
		});
	}

	// --- report ------------------------------------------------------------
	const where = tag ? `if we move to ${tag}` : `against the working tree`;
	if (manual.length === 0 && notes.length === 0) {
		console.log(`novel-prompts: nothing needs a human ${where}.`);
		console.log(`               ${spec.rules.length} rules, ${(spec.delegations || []).length} delegations, ${(spec.accepted || []).length} accepted.`);
		return 0;
	}

	if (manual.length) {
		console.log(`\nnovel-prompts: ${manual.length} item(s) need Claude Code ${where}.\n`);
		for (const m of manual) {
			console.log(`    [${m.kind}] ${m.what}`);
			console.log(`       ${m.detail}`);
			if (m.text) { console.log(`       text: ${m.text}`); }
			console.log(`       -> ${m.action}`);
			console.log('');
		}
	}
	if (notes.length) {
		console.log(`  ${notes.length} note(s), not blocking:\n`);
		for (const n of notes) {
			console.log(`    [${n.kind}] ${n.what} — ${n.detail}`);
			console.log(`       -> ${n.action}`);
		}
		console.log('');
	}
	return manual.length ? 1 : 0;
}

function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	if (cmd === 'apply') { return cmdApply(rest.includes('--dry-run')); }
	if (cmd === 'check') { return cmdCheck(rest.find(a => !a.startsWith('--'))); }
	console.error('usage: novel-prompts.js apply [--dry-run] | check [tag]');
	return 2;
}

process.exit(main());
