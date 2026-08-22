#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 * Novel Builder — upstream-edit invalidation detector.
 *
 * Every edit we make to an upstream file depends on some upstream text staying
 * the way it is. `git rebase` tells us when that text CONFLICTS. It does not
 * tell us when upstream quietly moved the meaning out from under an edit that
 * still applies cleanly — which is the failure mode that actually loses work.
 *
 * This records, for each hunk of our diff against the anchor tag, the exact
 * upstream pre-image the hunk consumed. Before a rebase we re-check every
 * pre-image against the NEW tag. An edit whose pre-image is gone is reported
 * as BROKEN and must be re-derived by hand — before the merge, not after.
 *
 *   scripts/novel-seams.js snapshot            # record pre-images at the anchor
 *   scripts/novel-seams.js check               # does the manifest still describe this tree?
 *   scripts/novel-seams.js applied             # are all recorded edits still present?
 *   scripts/novel-seams.js verify <newtag>     # can our edits still be applied?
 *   scripts/novel-seams.js verify <newtag> --json
 *
 * Exit codes: 0 all edits still valid · 1 at least one BROKEN · 2 usage error.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const MANIFEST = path.join(REPO, 'build', 'novel', 'seams.json');
const ANCHOR = process.env.NOVEL_ANCHOR_TAG || '1.129.1';

function git(args, opts = {}) {
	return execFileSync('git', args, {
		cwd: REPO,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		...opts
	});
}

function gitOrNull(args) {
	try {
		return git(args, { stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return null;
	}
}

function sha(text) {
	return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Split a unified diff into per-hunk records. For each hunk the "pre-image" is
 * the text the hunk consumed from upstream: the removed lines if there are any,
 * otherwise the context lines the insertion is anchored between.
 *
 * Removed lines are the stronger signal — they are literally the upstream text
 * our edit replaced, so if upstream rewrote it the edit is meaningless even
 * when git can still apply it somewhere.
 */
function parseHunks(diffText, anchorLines) {
	const out = [];
	let file = null;
	let hunk = null;

	const flush = () => {
		if (!hunk) { return; }
		const removed = hunk.lines.filter(l => l[0] === '-').map(l => l.slice(1));
		let pre;
		let kind;
		if (removed.length > 0) {
			// -U0 guarantees this run is contiguous in the original file, so the
			// joined text is a verbatim substring of the anchor blob. Minimal by
			// construction: an unrelated upstream edit three lines away cannot
			// invalidate it, which is what makes "touched nearby" survive.
			pre = removed.join('\n');
			kind = 'replace';
		} else {
			// Pure insertion has no pre-image of its own. Anchor it on the three
			// lines it was inserted after — enough to be unique, small enough to
			// tolerate churn elsewhere in the file.
			const lines = anchorLines(hunk.file);
			if (!lines) { hunk = null; return; }
			const end = hunk.oldStart;
			pre = lines.slice(Math.max(0, end - 3), end).join('\n');
			kind = 'insert';
		}
		pre = pre.replace(/\s+$/, '');
		if (pre.trim()) {
			// Some pre-images legitimately repeat — the same identity sentence
			// appears in two classes in one file. Duplication is not the signal;
			// a DROP in the count is (upstream rewrote one of the copies).
			const lines = anchorLines(hunk.file);
			const occurrences = lines ? lines.join('\n').split(pre).length - 1 : 1;
			// The post-image — the text WE wrote. Recorded so `applied` can ask
			// whether the edit is still in the tree, a question the pre-image
			// cannot answer: a hunk dropped while resolving a conflict leaves
			// upstream's pre-image perfectly intact.
			const added = hunk.lines.filter(l => l[0] === '+').map(l => l.slice(1)).join('\n').replace(/\s+$/, '');
			out.push({
				path: hunk.file, header: hunk.header, kind,
				preImage: pre, preImageSha: sha(pre), occurrences,
				postImage: added, postImageSha: added ? sha(added) : null
			});
		}
		hunk = null;
	};

	for (const line of diffText.split('\n')) {
		if (line.startsWith('diff --git ')) { flush(); file = null; continue; }
		if (line.startsWith('--- a/')) { continue; }
		if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
		if (line.startsWith('@@')) {
			flush();
			const m = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
			hunk = {
				file,
				header: line.split('@@')[1].trim(),
				oldStart: m ? Number(m[1]) : 0,
				lines: []
			};
			continue;
		}
		if (hunk && (line[0] === ' ' || line[0] === '-' || line[0] === '+')) {
			hunk.lines.push(line);
		}
	}
	flush();
	return out;
}

/** Map anchor-tag paths to their path at `tag`, following renames. */
function renameMap(tag) {
	const map = new Map();
	const raw = gitOrNull(['diff', '--name-status', '-M', ANCHOR, tag]) || '';
	for (const line of raw.split('\n')) {
		const parts = line.split('\t');
		if (parts[0] && parts[0][0] === 'R' && parts.length >= 3) {
			map.set(parts[1], parts[2]);
		} else if (parts[0] === 'D' && parts[1]) {
			map.set(parts[1], null);
		}
	}
	return map;
}

function blobAt(tag, filePath) {
	return gitOrNull(['show', `${tag}:${filePath}`]);
}

/*
 * Structured-data seams.
 *
 * Hunk pre-images are the wrong tool for JSON: `}` and `"tags": []` occur
 * hundreds of times in package.json, so a textual fingerprint is either
 * ambiguous or brittle against reformatting. For data files we assert on
 * MEANING instead — "the tool named copilot_getErrors exists and upstream sets
 * no `when` on it". Upstream renaming the tool, deleting it, or giving it its
 * own `when` all produce a precise failure instead of a silent one.
 *
 * Selector grammar (deliberately tiny):
 *   a.b.c                    plain property walk
 *   a.b[name=foo].c          pick the array element whose `name` is `foo`
 *   a.b[2].c                 array index
 *   a['x.y'].c               literal key (settings ids contain dots)
 *
 * Hand-maintained: adding a data seam is the same deliberate act as adding a
 * file to novel-guard's allowlist.
 */
const DATA_SEAMS_PATH = path.join(REPO, 'build', 'novel', 'data-seams.json');

function tokenizeSelector(selector) {
	const tokens = [];
	const re = /\['([^']+)'\]|\[(\d+)\]|\[([^=\]]+)=([^\]]+)\]|([^.[\]]+)/g;
	let m;
	while ((m = re.exec(selector)) !== null) {
		if (m[1] !== undefined) { tokens.push({ t: 'key', k: m[1] }); }
		else if (m[2] !== undefined) { tokens.push({ t: 'index', i: Number(m[2]) }); }
		else if (m[3] !== undefined) { tokens.push({ t: 'find', k: m[3], v: m[4] }); }
		else { tokens.push({ t: 'key', k: m[5] }); }
	}
	return tokens;
}

function selectPath(root, selector) {
	let cur = root;
	for (const tok of tokenizeSelector(selector)) {
		if (cur === undefined || cur === null) { return undefined; }
		if (tok.t === 'key') { cur = cur[tok.k]; }
		else if (tok.t === 'index') { cur = Array.isArray(cur) ? cur[tok.i] : undefined; }
		else { cur = Array.isArray(cur) ? cur.find(e => e && e[tok.k] === tok.v) : undefined; }
	}
	return cur;
}

function verifyDataSeams(tag) {
	if (!fs.existsSync(DATA_SEAMS_PATH)) { return []; }
	const spec = JSON.parse(fs.readFileSync(DATA_SEAMS_PATH, 'utf8'));
	const results = [];
	const cache = new Map();

	for (const seam of spec.seams) {
		if (!cache.has(seam.file)) {
			const blob = blobAt(tag, seam.file);
			cache.set(seam.file, blob === null ? null : parseJsonc(blob));
		}
		const doc = cache.get(seam.file);
		const base = {
			path: seam.file,
			target: seam.file,
			header: seam.selector,
			kind: 'data',
			preImage: `${seam.selector} === ${JSON.stringify(seam.upstream)}`
		};
		if (doc === null) {
			results.push({ ...base, status: 'GONE' });
			continue;
		}
		const actual = selectPath(doc, seam.selector);
		// `absent: true` means upstream deliberately has no value here — the
		// interesting change is upstream STARTING to set one, which would make
		// our unconditional override silently discard it.
		const ok = seam.absent ? actual === undefined : JSON.stringify(actual) === JSON.stringify(seam.upstream);
		results.push({
			...base,
			preImage: seam.absent ? `${seam.selector} is unset upstream` : base.preImage,
			status: ok ? 'INTACT' : 'BROKEN',
			actual: actual === undefined ? '(unset)' : JSON.stringify(actual)
		});
	}
	return results;
}

function cmdSnapshot() {
	const diff = git(['diff', '--no-color', '-U0', ANCHOR, '--', '.']);
	// Data files are covered by data-seams.json; textual hunks over them are noise.
	const dataFiles = fs.existsSync(DATA_SEAMS_PATH)
		? new Set(JSON.parse(fs.readFileSync(DATA_SEAMS_PATH, 'utf8')).seams.map(s => s.file))
		: new Set();
	const lineCache = new Map();
	const anchorLines = f => {
		if (!lineCache.has(f)) {
			const blob = blobAt(ANCHOR, f);
			lineCache.set(f, blob === null ? null : blob.split('\n'));
		}
		return lineCache.get(f);
	};
	const hunks = parseHunks(diff, anchorLines).filter(h => !dataFiles.has(h.path));
	const manifest = {
		anchor: ANCHOR,
		anchorCommit: git(['rev-parse', ANCHOR]).trim(),
		generated: new Date().toISOString(),
		seams: hunks
	};
	fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
	fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, '\t') + '\n');

	const byFile = new Map();
	for (const h of hunks) { byFile.set(h.path, (byFile.get(h.path) || 0) + 1); }
	console.log(`novel-seams: recorded ${hunks.length} seams across ${byFile.size} upstream files at ${ANCHOR}`);
	console.log(`             -> ${path.relative(REPO, MANIFEST)}`);
	return 0;
}

function cmdVerify(tag, asJson) {
	if (!fs.existsSync(MANIFEST)) {
		console.error(`novel-seams: no manifest at ${path.relative(REPO, MANIFEST)}. Run 'snapshot' first.`);
		return 2;
	}
	if (!gitOrNull(['rev-parse', '--verify', tag])) {
		console.error(`novel-seams: '${tag}' is not a known ref. Fetch upstream tags first.`);
		return 2;
	}

	const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
	const renames = renameMap(tag);
	const blobCache = new Map();
	const results = [];

	for (const seam of manifest.seams) {
		let target = seam.path;
		if (renames.has(seam.path)) { target = renames.get(seam.path); }

		if (target === null) {
			results.push({ ...seam, target: null, status: 'GONE' });
			continue;
		}

		if (!blobCache.has(target)) { blobCache.set(target, blobAt(tag, target)); }
		const blob = blobCache.get(target);

		if (blob === null) {
			results.push({ ...seam, target, status: 'GONE' });
			continue;
		}

		const occurrences = blob.split(seam.preImage).length - 1;
		const expected = seam.occurrences ?? 1;
		let status;
		if (occurrences === 0) {
			status = 'BROKEN';
		} else if (occurrences < expected) {
			// One of N identical copies was rewritten. Our edit still applies to
			// the survivors, but a slot we were covering has gone unhandled.
			status = 'PARTIAL';
		} else if (occurrences > expected) {
			status = 'AMBIGUOUS';
		} else if (target !== seam.path) {
			status = 'RENAMED';
		} else {
			// Present verbatim. Distinguish "file untouched" from "touched nearby"
			// purely for reviewer triage — both apply mechanically.
			const changed = gitOrNull(['diff', '--quiet', ANCHOR, tag, '--', target]) === null;
			status = changed ? 'MOVED' : 'INTACT';
		}
		results.push({ ...seam, target, status });
	}

	results.push(...verifyDataSeams(tag));

	if (asJson) {
		console.log(JSON.stringify({ anchor: manifest.anchor, tag, results }, null, '\t'));
	} else {
		report(manifest.anchor, tag, results);
	}

	const bad = results.filter(r => ['BROKEN', 'GONE', 'PARTIAL'].includes(r.status));
	return bad.length > 0 ? 1 : 0;
}

function report(anchor, tag, results) {
	const tally = {};
	for (const r of results) { tally[r.status] = (tally[r.status] || 0) + 1; }

	console.log(`\nnovel-seams: ${anchor} -> ${tag}   (${results.length} seams)`);
	console.log('  INTACT    upstream did not touch the file            ' + (tally.INTACT || 0));
	console.log('  MOVED     file changed, our pre-image is intact      ' + (tally.MOVED || 0));
	console.log('  RENAMED   file renamed, our pre-image is intact      ' + (tally.RENAMED || 0));
	console.log('  AMBIGUOUS pre-image now matches MORE places than before ' + (tally.AMBIGUOUS || 0));
	console.log('  PARTIAL   one of N identical copies was rewritten    ' + (tally.PARTIAL || 0));
	console.log('  BROKEN    upstream rewrote the region                ' + (tally.BROKEN || 0));
	console.log('  GONE      file deleted with no rename                ' + (tally.GONE || 0));

	const attention = results.filter(r => ['BROKEN', 'GONE', 'PARTIAL', 'AMBIGUOUS', 'RENAMED'].includes(r.status));
	if (attention.length) {
		console.log('\n  Needs a decision before the rebase:\n');
		for (const r of attention) {
			const where = r.target && r.target !== r.path ? `${r.path}  ->  ${r.target}` : r.path;
			console.log(`    [${r.status}] ${where}`);
			console.log(`             @@${r.header}@@  (${r.kind})`);
			console.log(`             expected: ${r.preImage.split('\n')[0].trim().slice(0, 96)}`);
			if (r.actual !== undefined) { console.log(`             found:    ${String(r.actual).slice(0, 96)}`); }
		}
	}

	if ((tally.BROKEN || 0) + (tally.GONE || 0) + (tally.PARTIAL || 0) > 0) {
		console.log('\n  BROKEN/GONE/PARTIAL means the upstream text our edit was written against no longer');
		console.log('  exists. git may still apply the hunk somewhere plausible — that is the');
		console.log('  danger. Re-derive these against the new tag before rebasing.\n');
	} else {
		console.log('\n  Every edit still has its upstream pre-image. Safe to rebase.\n');
	}
}

/**
 * Render one step of a route. Array elements are addressed by their `name` when
 * they have one, so a route survives upstream reordering the array — which
 * happens constantly in package.json's tool list and would otherwise show up as
 * every subsequent tool having changed.
 */
/**
 * Parses JSON that may carry comments.
 *
 * VS Code's own configuration files are JSONC — tsconfig.json ships with
 * comments upstream — so a strict JSON.parse reports them as unparseable and
 * the seam for that file silently stops being checked. Strings are respected so
 * a `//` inside a path is not mistaken for a comment.
 */
function parseJsonc(text) {
	let out = '';
	let inString = false, quote = '', inLine = false, inBlock = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i], next = text[i + 1];
		if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
		if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i++; } continue; }
		if (inString) {
			out += c;
			if (c === '\\') { out += next; i++; continue; }
			if (c === quote) { inString = false; }
			continue;
		}
		if (c === '"' || c === "'") { inString = true; quote = c; out += c; continue; }
		if (c === '/' && next === '/') { inLine = true; i++; continue; }
		if (c === '/' && next === '*') { inBlock = true; i++; continue; }
		out += c;
	}
	// Trailing commas are legal in JSONC and fatal in JSON.
	return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function stepKey(container, key) {
	if (!Array.isArray(container)) { return `.${key}`; }
	const el = container[key];
	if (!el || typeof el !== 'object') { return `[${key}]`; }
	// Identity fields, in the order VS Code's own manifest uses them. `command`
	// matters as much as `name`: contributes.commands is an array of objects
	// keyed by `command`, and without it every entry after an upstream insertion
	// reads as changed — the exact failure this function exists to prevent.
	//
	// `vendor` is here for the same reason, found the same way:
	// contributes.languageModelChatProviders is keyed by it, and this product
	// appends six entries to that array. Without it those six are addressed by
	// index, so one vendor inserted upstream shifts every one of them and the
	// seams report six false breakages while missing any real one.
	for (const field of ['name', 'command', 'id', 'key', 'vendor']) {
		if (typeof el[field] === 'string') { return `[${field}=${el[field]}]`; }
	}
	return `[${key}]`;
}

/** Flatten a JSON document to route -> serialized leaf value. */
function flattenLeaves(node, prefix, out) {
	if (node === null || typeof node !== 'object') {
		out.set(prefix, JSON.stringify(node));
		return out;
	}
	const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node);
	if (keys.length === 0) {
		out.set(prefix, Array.isArray(node) ? '[]' : '{}');
		return out;
	}
	for (const k of keys) { flattenLeaves(node[k], prefix + stepKey(node, k), out); }
	return out;
}

/**
 * Render a data seam's selector in the same route form flattenLeaves produces,
 * so the two can be compared. Resolved against the anchor document because that
 * is what the selector was written against.
 */
function seamRoute(anchorDoc, selector) {
	let cur = anchorDoc;
	let route = '';
	for (const tok of tokenizeSelector(selector)) {
		if (tok.t === 'key') {
			route += `.${tok.k}`;
			cur = cur === undefined || cur === null ? undefined : cur[tok.k];
		} else if (tok.t === 'index') {
			route += Array.isArray(cur) ? stepKey(cur, tok.i) : `[${tok.i}]`;
			cur = Array.isArray(cur) ? cur[tok.i] : undefined;
		} else {
			// Echo the key the selector actually used. Hardcoding `name` made a
			// `[command=…]` seam render as a route no edit could ever match.
			route += `[${tok.k}=${tok.v}]`;
			cur = Array.isArray(cur) ? cur.find(e => e && e[tok.k] === tok.v) : undefined;
		}
	}
	return route;
}

/**
 * Assert the recorded seams still describe the tree as it stands.
 *
 * `verify` answers "do our edits still fit the new upstream". It cannot answer
 * "are these still our edits" — it trusts the manifest. So an upstream file
 * edited without re-running `snapshot` is checked against pre-images for edits
 * that no longer exist, while the edit actually sitting in the tree is checked
 * against nothing, and the run reports Safe to rebase. The mechanism fails in
 * exactly the way it was built to prevent, one level up.
 *
 * This is the check that closes that. It belongs in CI and in novel-guard, not
 * in a habit.
 */
function cmdCheck() {
	const problems = [];

	if (!fs.existsSync(MANIFEST)) {
		console.error(`novel-seams: no manifest at ${path.relative(REPO, MANIFEST)}. Run 'snapshot' first.`);
		return 1;
	}
	const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

	const anchorCommit = git(['rev-parse', ANCHOR]).trim();
	if (manifest.anchorCommit !== anchorCommit) {
		problems.push(`ANCHOR MOVED    manifest was taken at ${manifest.anchorCommit.slice(0, 12)}, ${ANCHOR} is now ${anchorCommit.slice(0, 12)}`);
	}

	const dataSpec = fs.existsSync(DATA_SEAMS_PATH)
		? JSON.parse(fs.readFileSync(DATA_SEAMS_PATH, 'utf8'))
		: { seams: [] };
	const dataFiles = new Set(dataSpec.seams.map(s => s.file));

	// --- textual seams: recompute and compare ---------------------------------
	const lineCache = new Map();
	const anchorLines = f => {
		if (!lineCache.has(f)) {
			const blob = blobAt(ANCHOR, f);
			lineCache.set(f, blob === null ? null : blob.split('\n'));
		}
		return lineCache.get(f);
	};
	const live = parseHunks(git(['diff', '--no-color', '-U0', ANCHOR, '--', '.']), anchorLines)
		.filter(h => !dataFiles.has(h.path));

	const key = h => `${h.path} ${h.preImageSha}`;
	const recorded = new Map(manifest.seams.map(h => [key(h), h]));
	const present = new Map(live.map(h => [key(h), h]));

	for (const [k, h] of present) {
		if (!recorded.has(k)) { problems.push(`UNRECORDED      ${h.path}  @@${h.header}@@  — edited since the last snapshot, so nothing protects it`); }
	}
	for (const [k, h] of recorded) {
		if (!present.has(k)) { problems.push(`STALE           ${h.path}  @@${h.header}@@  — recorded but no longer in the tree`); }
	}

	// --- data seams: every changed leaf must be claimed by a seam -------------
	const changedFiles = git(['diff', '--name-only', ANCHOR, '--', '.']).split('\n').filter(Boolean);
	for (const file of changedFiles) {
		if (!file.endsWith('.json')) { continue; }
		const anchorBlob = blobAt(ANCHOR, file);
		if (anchorBlob === null) { continue; }   // ours, not upstream's
		let anchorDoc;
		let headDoc;
		try {
			anchorDoc = parseJsonc(anchorBlob);
			headDoc = parseJsonc(fs.readFileSync(path.join(REPO, file), 'utf8'));
		} catch (e) {
			problems.push(`UNPARSEABLE     ${file}  — ${e.message}`);
			continue;
		}

		const before = flattenLeaves(anchorDoc, '', new Map());
		const after = flattenLeaves(headDoc, '', new Map());
		const claimed = new Set(
			dataSpec.seams.filter(s => s.file === file).map(s => seamRoute(anchorDoc, s.selector))
		);
		// A `depends` seam records a value we deliberately left alone, so having
		// no edit under it is the expected state. Reporting that would put a
		// permanent note on every run for each one.
		const dependsOnly = new Set(
			dataSpec.seams.filter(s => s.file === file && s.depends).map(s => seamRoute(anchorDoc, s.selector))
		);

		const changed = [];
		for (const [route, v] of after) { if (before.get(route) !== v) { changed.push(route); } }
		for (const route of before.keys()) { if (!after.has(route)) { changed.push(route); } }

		// A seam recorded on a container covers everything under it: it stores
		// upstream's whole value there, so upstream changing any descendant
		// makes the seam stop matching. Comparing leaf routes against seam
		// routes literally would call such a seam unmatched and demand a
		// redundant one per leaf.
		const covers = route => [...claimed].some(c => route === c || route.startsWith(c + '.') || route.startsWith(c + '['));

		for (const route of changed) {
			if (!covers(route)) {
				problems.push(`UNCOVERED       ${file}  ${route}  — changed with no data seam recording what upstream held there`);
			}
		}
		for (const c of claimed) {
			if (dependsOnly.has(c)) { continue; }
			if (!changed.some(route => route === c || route.startsWith(c + '.') || route.startsWith(c + '['))) {
				// A seam over nothing we changed is forward-looking — recorded
				// before making the edit, which is the right order. Said out
				// loud rather than silently tolerated, so a seam that has
				// drifted onto a dead route gets noticed.
				console.log(`  note: ${file} ${c} has a seam but no edit under it yet`);
			}
		}
	}

	if (problems.length === 0) {
		console.log(`novel-seams: manifest matches the tree — ${live.length} textual seams, ${dataSpec.seams.length} data seams, anchor ${ANCHOR}.`);
		return 0;
	}
	console.log(`\nnovel-seams: the manifest no longer describes this tree (${problems.length}).\n`);
	for (const p of problems) { console.log(`    ${p}`); }
	console.log('\n  UNRECORDED/UNCOVERED: run \'snapshot\' (textual) or add a data seam (JSON).');
	console.log('  STALE: the edit was reverted — re-run \'snapshot\' to drop it.');
	console.log('  Until this is clean, \'verify\' is checking the wrong set of edits.\n');
	return 1;
}

/**
 * Assert every recorded edit is still in the tree.
 *
 * This is the question `verify` structurally cannot answer. `verify` compares
 * our recorded PRE-image against upstream: it asks whether the fact we wrote
 * against still holds. A hunk dropped while resolving a conflict leaves that
 * pre-image perfectly intact, so verify stays green over an edit that is gone.
 *
 * `check` catches a drop only while the anchor is unchanged. After a rebase the
 * anchor moves and the manifest is regenerated against the new tag — at which
 * point a dropped edit is simply not in the new manifest, and nothing ever
 * mentions it again. That is the one loss with no witness.
 *
 * So this runs AFTER a rebase and BEFORE re-snapshotting, against the manifest
 * from the old anchor. It asks only: is our text here? Anchor-independent by
 * construction.
 *
 * Comparison ignores leading whitespace, because a rebase legitimately
 * reindents. It does not ignore anything else: our edits are distinctive
 * sentences, and loosening further would start reporting success on text that
 * merely resembles ours.
 */
function cmdApplied() {
	if (!fs.existsSync(MANIFEST)) {
		console.error(`novel-seams: no manifest at ${path.relative(REPO, MANIFEST)}.`);
		return 2;
	}
	const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
	const norm = t => t.split('\n').map(l => l.trim()).filter(Boolean).join('\n');

	const missing = [];
	const unrecordable = [];
	const fileCache = new Map();
	const read = f => {
		if (!fileCache.has(f)) {
			const abs = path.join(REPO, f);
			fileCache.set(f, fs.existsSync(abs) ? norm(fs.readFileSync(abs, 'utf8')) : null);
		}
		return fileCache.get(f);
	};

	for (const seam of manifest.seams) {
		if (!seam.postImage) {
			// A pure deletion has no post-image to look for. Recorded so the
			// count reconciles rather than quietly shrinking.
			unrecordable.push(seam);
			continue;
		}
		const body = read(seam.path);
		if (body === null) { missing.push({ seam, why: 'the file is gone' }); continue; }
		if (!body.includes(norm(seam.postImage))) { missing.push({ seam, why: 'our text is not in it' }); }
	}

	// Data seams: our edit is precisely that the value is no longer upstream's.
	let pending = 0;
	let depends = 0;
	if (fs.existsSync(DATA_SEAMS_PATH)) {
		const spec = JSON.parse(fs.readFileSync(DATA_SEAMS_PATH, 'utf8'));
		for (const seam of spec.seams) {
			// A seam recorded before its edit is made — capturing upstream's value
			// while it is still there is the right order, but until the edit lands
			// "we have not written this yet" and "this was lost" look identical.
			// Two standing false reds would be enough to stop anyone reading the
			// output at all, which costs more than the check is worth.
			if (seam.pending) { pending++; continue; }
			// A `depends` seam records a value we deliberately did NOT change and
			// rely on staying put. There is no edit to look for, so asking "does
			// this differ from upstream" is inverted — it would report every one
			// of them as missing forever. `verify` still checks them, which is
			// the whole point: upstream moving one breaks us precisely because we
			// left it alone.
			if (seam.depends) { depends++; continue; }
			const abs = path.join(REPO, seam.file);
			if (!fs.existsSync(abs)) { missing.push({ seam: { path: seam.file, header: seam.selector }, why: 'the file is gone' }); continue; }
			let doc;
			try { doc = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue; }
			const actual = selectPath(doc, seam.selector);
			// `absent` seams mark a route upstream leaves empty and we fill.
			const applied = seam.absent ? actual !== undefined : JSON.stringify(actual) !== JSON.stringify(seam.upstream);
			if (!applied) {
				missing.push({
					seam: { path: seam.file, header: seam.selector },
					why: seam.absent ? 'we set nothing there' : 'the value is back to upstream\'s'
				});
			}
		}
	}

	if (missing.length === 0) {
		console.log(`novel-seams: every recorded edit is present (${manifest.seams.length} textual seams, anchor ${manifest.anchor}).`);
		if (unrecordable.length) { console.log(`             ${unrecordable.length} pure deletions have no post-image and were not checked.`); }
		if (pending) { console.log(`             ${pending} data seam(s) are recorded but not yet applied (pending).`); }
		if (depends) { console.log(`             ${depends} record a value we depend on rather than an edit.`); }
		return 0;
	}
	console.log(`\nnovel-seams: ${missing.length} recorded edit(s) are no longer in the tree.\n`);
	for (const m of missing) {
		console.log(`    MISSING  ${m.seam.path}  @@${m.seam.header}@@  — ${m.why}`);
		if (m.seam.postImage) { console.log(`             ours: ${m.seam.postImage.split('\n')[0].trim().slice(0, 96)}`); }
	}
	console.log('\n  An edit went into a rebase and did not come out. Restore it from the');
	console.log('  previous anchor before re-snapshotting — once the manifest is');
	console.log('  regenerated the edit is gone with no record that it existed.\n');
	return 1;
}

function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	if (cmd === 'snapshot') { return cmdSnapshot(); }
	if (cmd === 'check') { return cmdCheck(); }
	if (cmd === 'applied') { return cmdApplied(); }
	if (cmd === 'verify') {
		const tag = rest.find(a => !a.startsWith('--'));
		if (!tag) { console.error('novel-seams: verify needs a tag'); return 2; }
		return cmdVerify(tag, rest.includes('--json'));
	}
	console.error('usage: novel-seams.js snapshot | check | applied | verify <tag> [--json]');
	return 2;
}

process.exit(main());
