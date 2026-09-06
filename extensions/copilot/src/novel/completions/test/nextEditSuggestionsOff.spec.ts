/*---------------------------------------------------------------------------------------------
 *  VS Novel — next edit suggestions ship off.
 *--------------------------------------------------------------------------------------------*/

/**
 * NES asks a model where the author should edit *next* — a suggestion somewhere
 * other than the caret, which may delete or rewrite existing text. For code that
 * is the payoff of a rename: change the declaration, and it offers the three
 * call sites. For a manuscript the equivalent would be renaming a character and
 * being offered the two later paragraphs that still use the old name — which
 * this product already answers offline, and exactly, from the name index.
 *
 * It ships off for two reasons that both have to hold before it can ship on:
 *
 *  1. It has never worked here. The model name is hardcoded upstream
 *     (`inlineEditsModelService.ts`, `nes-callisto`) and our catalog has no such
 *     model, so every request came back 404 `that model is not available on this
 *     account` — one every few seconds while typing, with nothing on screen to
 *     say why the feature was silent.
 *  2. Its prompting is built for code: line-tagged context, a structured edit in
 *     reply. Pointing it at a real model without measuring what that produces on
 *     Chinese prose would be shipping a guess, and it fires more often than
 *     completion does, so the guess would be billed.
 *
 * It is a setting, not a removal: `github.copilot.nextEditSuggestions.enabled`
 * turns it back on.
 *
 * The default is declared twice — in package.json, which is what the running
 * editor reads, and in `configurationService.ts`, which is the fallback for a
 * setting the manifest does not contribute. They are not free to drift: the
 * config registry compares them at load and throws, which takes the whole
 * extension down rather than degrading. Changing only the manifest is therefore
 * not a smaller change, it is a broken one — measured, and the reason the second
 * assertion below exists.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const EXTENSION_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const CONFIG_SOURCE = 'src/platform/configuration/common/configurationService.ts';

function manifestProperty(id: string): { type?: unknown; default?: unknown } {
	const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8'));
	for (const block of [manifest.contributes.configuration].flat()) {
		const property = block?.properties?.[id];
		if (property) {
			return property;
		}
	}
	throw new Error(`package.json no longer declares ${id}`);
}

/** The same default as `defineSetting` declares it. */
function codeDefault(): boolean {
	const source = fs.readFileSync(path.join(EXTENSION_ROOT, CONFIG_SOURCE), 'utf8');
	const match = source.match(/defineSetting<boolean>\('nextEditSuggestions\.enabled',[^)]*?(true|false)\)/);
	expect(match, `${CONFIG_SOURCE} no longer declares nextEditSuggestions.enabled`).toBeTruthy();
	return match![1] === 'true';
}

describe('next edit suggestions', () => {

	// Upstream ships this true, so a rebase that takes their manifest lands here
	// rather than as a 404 every few seconds that nothing on screen explains.
	it('are off by default', () => {
		expect(manifestProperty('github.copilot.nextEditSuggestions.enabled').default).toBe(false);
	});

	// Not a style point. The registry throws when these two disagree, and it
	// throws at load — the extension does not start at all.
	it('say so in both places that declare it', () => {
		expect(codeDefault()).toBe(manifestProperty('github.copilot.nextEditSuggestions.enabled').default);
	});

	it('are still a setting the author can turn on', () => {
		expect(manifestProperty('github.copilot.nextEditSuggestions.enabled').type).toBe('boolean');
	});
});
