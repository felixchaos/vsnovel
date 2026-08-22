#!/usr/bin/env node
// Checks that every translated key still exists in the source it claims.
//
// A language pack fails silently by design: core looks a key up, misses, and
// renders English. That is the right behaviour for an incomplete translation
// and the wrong one for a stale entry — upstream renames a key, the entry stops
// applying, and nothing anywhere says so. The symptom is one menu item quietly
// reverting to English between releases, which nobody notices until a user asks.
//
// Two packs, three key schemes, all of them silent when wrong:
//
//   main.i18n.json      contents["<bundle>"]["<key>"]  — core nls.localize key
//   copilot.i18n.json   contents.package["<key>"]      — package.nls.json key
//                       contents.bundle["<english>"]   — the English text ITSELF
//
// The third is the sharp one. extHostLocalizationService.ts:41 builds the
// lookup key from the message, so a translation is matched by comparing the
// full English sentence character for character. A trailing period, a curly
// quote or a renamed placeholder is enough to miss, and a miss looks exactly
// like "not translated yet".
//
//   node scripts/novel-i18n-check.js
//
// Exits non-zero when an entry no longer matches its source.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'extensions/novel-lang-zh/translations/main.i18n.json');
const EXT_PACK = path.join(ROOT, 'extensions/novel-lang-zh/translations/copilot.i18n.json');
const EXT = path.join(ROOT, 'extensions/copilot');

// Bundle ids are relative to `src/`, mirroring the layout under `out/` that
// core resolves them against at runtime.
function bundleSource(bundle) {
	for (const ext of ['.ts', '.tsx']) {
		const candidate = path.join(ROOT, 'src', bundle + ext);
		if (fs.existsSync(candidate)) {
			return fs.readFileSync(candidate, 'utf8');
		}
	}
	return undefined;
}

/**
 * Whether `key` is used by a localize call in `source`.
 *
 * Matched against the call rather than against the bare string: a key is a
 * short word like "delete" or "rename", and searching for it as text finds it
 * in a dozen unrelated places. The object form — localize({ key: 'x', comment })
 * — is matched too, because upstream uses it wherever a translator needs
 * context.
 */
function declaresKey(source, key) {
	const quoted = `['"\`]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`;
	return new RegExp(`localize2?\\(\\s*${quoted}`).test(source)
		|| new RegExp(`localize2?\\(\\s*\\{[^}]*key:\\s*${quoted}`).test(source);
}

function checkCore(problems) {
	const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
	let checked = 0;
	for (const [bundle, entries] of Object.entries(pack.contents ?? {})) {
		const source = bundleSource(bundle);
		if (source === undefined) {
			problems.push(`${bundle}: no such source file — the module moved or was removed upstream`);
			continue;
		}
		for (const key of Object.keys(entries)) {
			checked++;
			if (!declaresKey(source, key)) {
				problems.push(`${bundle}: key "${key}" is no longer declared there — this entry does nothing`);
			}
		}
	}
	return { checked, bundles: Object.keys(pack.contents ?? {}).length };
}

function walk(dir, out) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.git') {
			continue;
		}
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(p, out);
		} else if (/\.tsx?$/.test(entry.name)) {
			out.push(p);
		}
	}
	return out;
}

/** Decodes the escapes a JS string literal may carry, so keys compare as runtime text. */
function unescapeLiteral(raw) {
	return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(.))/g,
		(_, __, brace, u4, x2, ch) => {
			if (brace) { return String.fromCodePoint(parseInt(brace, 16)); }
			if (u4) { return String.fromCharCode(parseInt(u4, 16)); }
			if (x2) { return String.fromCharCode(parseInt(x2, 16)); }
			return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }[ch] ?? ch;
		});
}

/** Every single-line `l10n.t('…')` / `t('…')` message in the extension, as runtime text. */
function extensionMessages() {
	const call = /\bl10n\.t\(\s*(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1|(?<![.\w])t\(\s*(['"])((?:\\.|(?!\3)[^\\\r\n])*)\3/g;
	const messages = new Set();
	for (const file of walk(path.join(EXT, 'src'), [])) {
		const src = fs.readFileSync(file, 'utf8');
		if (!src.includes('l10n')) {
			continue;
		}
		for (const m of src.matchAll(call)) {
			messages.add(unescapeLiteral(m[2] ?? m[4]));
		}
	}
	return messages;
}

/**
 * The longest prefix of `message` that a bundler cannot have re-escaped, so a
 * substring search over minified output means what it looks like it means.
 */
function bundleProbe(message) {
	const probe = message.split(/[\n\r\t'"`\\]/)[0].slice(0, 60);
	return probe.length >= 8 ? probe : undefined;
}

/**
 * Whether `probe` appears in bundled output.
 *
 * esbuild writes ASCII by default, so any non-ASCII character in a message — an
 * em dash, a CJK quote — is emitted as \uXXXX. A plain substring search misses
 * those and reports a string that renders perfectly well as rendering nowhere,
 * which is worse than not checking: it invites someone to delete a correct
 * translation. Both spellings are accepted.
 */
function distContains(dist, probe) {
	if (dist.includes(probe)) {
		return true;
	}
	const escaped = [...probe]
		.map(ch => (ch.codePointAt(0) > 0x7f
			? '\\u' + ch.codePointAt(0).toString(16).padStart(4, '0')
			: ch))
		.join('');
	return escaped !== probe && dist.includes(escaped);
}

function checkExtension(problems) {
	if (!fs.existsSync(EXT_PACK)) {
		return { checked: 0 };
	}
	const pack = JSON.parse(fs.readFileSync(EXT_PACK, 'utf8'));
	const nls = JSON.parse(fs.readFileSync(path.join(EXT, 'package.nls.json'), 'utf8'));
	const manifest = fs.readFileSync(path.join(EXT, 'package.json'), 'utf8');
	const messages = extensionMessages();

	// Built output is optional: a fresh checkout has none, and the source check
	// still applies. When it exists it is the only authority on what a user can
	// actually see — a third of the extension's branded strings live in the
	// chatSessions subtree, which is excluded from the build, so translating
	// them would read as covered while rendering nowhere.
	const distPath = path.join(EXT, 'dist/extension.js');
	const dist = fs.existsSync(distPath) ? fs.readFileSync(distPath, 'utf8') : undefined;

	let checked = 0;
	for (const key of Object.keys(pack.contents?.package ?? {})) {
		checked++;
		if (!(key in nls)) {
			problems.push(`copilot package: "${key}" is not in package.nls.json — upstream renamed or dropped it`);
		} else if (!manifest.includes(`%${key}%`)) {
			problems.push(`copilot package: "${key}" is declared but no longer referenced from package.json — the contribution using it is gone`);
		}
	}
	for (const key of Object.keys(pack.contents?.bundle ?? {})) {
		checked++;
		if (!messages.has(key)) {
			problems.push(`copilot bundle: no l10n.t() in the extension passes exactly this text — "${key.slice(0, 70)}"`);
			continue;
		}
		const probe = dist && bundleProbe(key);
		if (probe && !distContains(dist, probe)) {
			problems.push(`copilot bundle: "${key.slice(0, 60)}" is in the source but not in dist/extension.js — it renders nowhere, so translating it only hides that`);
		}
	}
	return { checked };
}

function main() {
	if (!fs.existsSync(PACK)) {
		console.error(`novel-i18n: no translation file at ${path.relative(ROOT, PACK)}`);
		process.exit(2);
	}

	const problems = [];
	const core = checkCore(problems);
	const ext = checkExtension(problems);

	if (problems.length > 0) {
		console.error('novel-i18n: stale entries — each one silently renders English\n');
		for (const p of problems) {
			console.error(`    ${p}`);
		}
		console.error('\n  Core key:      grep -rn "localize(\'<key>\'" src/vs');
		console.error('  Extension key: grep -rn "%<key>%" extensions/copilot/package.json');
		console.error('  Extension text is matched verbatim — copy it out of the l10n.t() call, do not retype it.');
		console.error('  Removing the entry is a valid fix; leaving it is not, because it looks translated.');
		process.exit(1);
	}

	console.log(`novel-i18n: OK — ${core.checked} core entries across ${core.bundles} bundles`
		+ `, ${ext.checked} copilot entries, all still declared`);
}

main();
