/*---------------------------------------------------------------------------------------------
 *  VS Novel — markdown and plaintext are completion-enabled.
 *--------------------------------------------------------------------------------------------*/

/**
 * The per-language completion switch is declared twice.
 *
 * `github.copilot.enable` has its user-facing default in package.json and a
 * second copy in the completions-core config table, whose own comment says it
 * mirrors package.json. Nothing enforces that. Changing only one is the
 * documented failure (limitation I-02, 方案文档/02): the setting reads as
 * enabled while the code path that consults the default still refuses, and the
 * symptom is inline completion silently doing nothing in the only two file types
 * this product serves.
 *
 * Read from the files rather than imported: the point is that the two
 * *declarations* agree, which an import would hide by resolving one of them.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const EXTENSION_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CONFIG_TABLE = 'src/extension/completions-core/vscode-node/lib/src/config.ts';

function read(rel: string): string {
	return fs.readFileSync(path.join(EXTENSION_ROOT, rel), 'utf8');
}

/** The `github.copilot.enable` default as package.json declares it. */
function manifestDefault(): Record<string, boolean> {
	const manifest = JSON.parse(read('package.json'));
	const blocks = [manifest.contributes.configuration].flat();
	for (const block of blocks) {
		const property = block?.properties?.['github.copilot.enable'];
		if (property?.default) {
			return property.default;
		}
	}
	throw new Error('package.json no longer declares a github.copilot.enable default');
}

/** The same default as the completions-core table declares it. */
function configTableDefault(): Record<string, boolean> {
	const line = read(CONFIG_TABLE)
		.split('\n')
		.find(l => l.includes('ConfigKey.Enable,'));
	expect(line, `${CONFIG_TABLE} no longer has a ConfigKey.Enable row`).toBeTruthy();

	const object = line!.slice(line!.indexOf('{'), line!.lastIndexOf('}') + 1);
	return Object.fromEntries(
		[...object.matchAll(/'([^']+)':\s*(true|false)/g)].map(m => [m[1], m[2] === 'true'])
	);
}

describe('prose languages are completion-enabled', () => {

	it('enables the file types a novel is written in', () => {
		for (const declared of [manifestDefault(), configTableDefault()]) {
			expect(declared.markdown).toBe(true);
			expect(declared.plaintext).toBe(true);
		}
	});

	// The whole reason this file exists. Upstream ships both as false, so a rebase
	// that takes their version of either one lands here rather than in a bug
	// report about completions not appearing.
	it('keeps the two declarations in agreement', () => {
		expect(configTableDefault()).toEqual(manifestDefault());
	});

	// Not prose: it is the commit-message box. Enabling it would put the novel
	// completion model behind a control that has nothing to do with the novel,
	// and its being false is what shows the two above were set deliberately
	// rather than by turning everything on.
	it('leaves scminput alone', () => {
		expect(manifestDefault().scminput).toBe(false);
	});
});
