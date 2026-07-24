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

const timestamp = Date.now();
const manifest = { productVersion: opts.productVersion, timestamp, platforms: {} };

for (const [platform, path] of Object.entries(platforms)) {
	const bytes = readFileSync(path); // throws if the artifact is missing — better than shipping a dead URL
	const filename = path.split('/').pop();
	manifest.platforms[platform] = {
		version: opts.version,
		productVersion: opts.productVersion,
		timestamp,
		url: `https://github.com/${opts.repo}/releases/download/${opts.tag}/${filename}`,
		sha256hash: createHash('sha256').update(bytes).digest('hex'),
	};
}

const json = JSON.stringify(manifest, null, '\t') + '\n';
if (opts.out) {
	writeFileSync(opts.out, json);
	process.stderr.write(`make-manifest: wrote ${opts.out} (${Object.keys(manifest.platforms).join(', ')})\n`);
} else {
	process.stdout.write(json);
}
