#!/usr/bin/env node
// Build update-manifest.json for one release.
//
// The update Worker serves whatever this produces: one entry per platform, each
// carrying the release asset's download URL and its sha256. The editor's
// updater verifies that hash (Windows) or the Developer ID signature (macOS)
// before installing, so the manifest is a routing table, not a trust anchor.
//
// Usage:
//   node make-manifest.mjs \
//     --repo felixchaos/vsnovel --tag v1.129.1-nvl.3 \
//     --version <build-commit-sha> --product-version 1.129.1-nvl.3 \
//     darwin-arm64=/path/VisualStudioNovel-darwin-arm64.zip \
//     win32-x64-user=/path/VSNovelUserSetup-x64.exe \
//     [--out update-manifest.json]
//
// `--version` is the commit VS Code stamped into product.commit for this build;
// the editor reports its own commit back and the Worker returns 204 when they
// match, so this must be the exact SHA the artifacts were built from.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function fail(msg) {
	process.stderr.write(`make-manifest: ${msg}\n`);
	process.exit(2);
}

const FLAGS = { 'repo': 'repo', 'tag': 'tag', 'version': 'version', 'product-version': 'productVersion', 'out': 'out' };
const opts = { repo: '', tag: '', version: '', productVersion: '', out: '' };
const platforms = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	// Accept both --flag=value and --flag value.
	const flag = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
	if (flag) {
		const key = FLAGS[flag[1]];
		if (!key) { fail(`unknown flag ${arg}`); }
		opts[key] = flag[2] !== undefined ? flag[2] : argv[++i];
		if (opts[key] === undefined) { fail(`--${flag[1]} needs a value`); }
		continue;
	}
	const kv = arg.match(/^([^=]+)=(.+)$/);
	if (!kv) { fail(`expected platform=path, got ${arg}`); }
	platforms[kv[1]] = kv[2];
}

for (const k of ['repo', 'tag', 'version', 'productVersion']) {
	if (!opts[k]) { fail(`missing --${k === 'productVersion' ? 'product-version' : k}`); }
}
if (Object.keys(platforms).length === 0) { fail('no platform=path artifacts given'); }

/**
 * Platforms that are served by another platform's artifact.
 *
 * On Windows the editor picks its platform string by looking for `unins000.exe`
 * next to the executable — the uninstaller Inno leaves behind. Present means
 * `win32-<arch>-user`; absent means `win32-<arch>-archive`
 * (updateService.win32.ts:49, :211). An install that was unpacked rather than
 * run through the installer therefore asks for `-archive`, and this product
 * publishes no such key, so the Worker answers 204 — "already current" — and
 * keeps answering it forever. The author is never told an update exists and has
 * nothing to notice.
 *
 * Unpacking is not an exotic thing to do here: the Windows build carries no
 * Authenticode signature, so SmartScreen warns on first run, and extracting the
 * setup with 7-zip is the obvious way around that.
 *
 * Pointing `-archive` at the same installer is correct rather than a bodge. The
 * archive branch does not apply an update itself; it enters
 * `AvailableForDownload` and hands the URL to the user
 * (updateService.win32.ts:264). Downloading the installer is exactly what that
 * user should do next.
 */
const ALIASES = { 'win32-x64-user': ['win32-x64-archive'], 'win32-arm64-user': ['win32-arm64-archive'] };

const timestamp = Date.now();
const manifest = { productVersion: opts.productVersion, timestamp, platforms: {} };

for (const [platform, path] of Object.entries(platforms)) {
	const bytes = readFileSync(path); // throws if the artifact is missing — better than shipping a dead URL
	const filename = path.split('/').pop();
	const entry = {
		version: opts.version,
		productVersion: opts.productVersion,
		timestamp,
		url: `https://github.com/${opts.repo}/releases/download/${opts.tag}/${filename}`,
		sha256hash: createHash('sha256').update(bytes).digest('hex'),
	};
	manifest.platforms[platform] = entry;
	// An explicitly given platform always wins over an alias for it.
	for (const alias of ALIASES[platform] ?? []) {
		if (!(alias in platforms)) { manifest.platforms[alias] = entry; }
	}
}

const json = JSON.stringify(manifest, null, '\t') + '\n';
if (opts.out) {
	writeFileSync(opts.out, json);
	process.stderr.write(`make-manifest: wrote ${opts.out} (${Object.keys(manifest.platforms).join(', ')})\n`);
} else {
	process.stdout.write(json);
}
