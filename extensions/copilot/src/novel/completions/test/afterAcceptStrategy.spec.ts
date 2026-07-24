/*---------------------------------------------------------------------------------------------
 *  VS Novel — accepting a sentence does not silence the next suggestion.
 *--------------------------------------------------------------------------------------------*/

/**
 * After a completion is accepted, upstream replaces the server-side strategy
 * with a client-parsed one capped at one line, twenty tokens, and a stop at the
 * first blank line. For code that is a reasonable brake. For a manuscript it
 * fires exactly when the author has signalled they want more, and markdown and
 * plaintext are the two languages that lose the most by it — they reach
 * BlockMode.Server with no client-side trimming at all, which is the best path
 * available to them.
 *
 * The assertions are on the strategy object rather than on any rendered text,
 * because the strategy *is* the decision: `blockMode`, `stop` and `maxTokens`
 * are what the request is built from.
 */

import { describe, expect, it } from 'vitest';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BlockMode } from '../../../extension/completions-core/vscode-node/lib/src/config';
import { ICompletionsFeaturesService } from '../../../extension/completions-core/vscode-node/lib/src/experiments/featuresService';
import { ICompletionsBlockModeConfig } from '../../../extension/completions-core/vscode-node/lib/src/ghostText/configBlockMode';
import { getGhostTextStrategy } from '../../../extension/completions-core/vscode-node/lib/src/ghostText/ghostTextStrategy';

/**
 * The three services this path reads before it branches. Anything else would be
 * a change in which path is taken, and should fail loudly rather than be faked.
 */
function accessorFor(languageId: string) {
	const services = new Map<unknown, unknown>([
		[ICompletionsFeaturesService, { multilineAfterAcceptLines: () => 1 }],
		[ICompletionsBlockModeConfig, { forLanguage: () => BlockMode.Server }],
		[IInstantiationService, {}],
	]);
	return {
		get: (id: unknown) => {
			if (!services.has(id)) {
				throw new Error(`unexpected service on this path: ${String(id)}`);
			}
			return services.get(id);
		}
	} as never;
}

function completionStateFor(languageId: string) {
	return { textDocument: { detectedLanguageId: languageId } } as never;
}

async function strategyAfterAccepting(languageId: string) {
	return getGhostTextStrategy(
		accessorFor(languageId), completionStateFor(languageId),
		'', {} as never, true, /* hasAcceptedCurrentCompletion */ true, {} as never
	);
}

describe('strategy after accepting a completion', () => {

	for (const languageId of ['markdown', 'plaintext']) {
		it(`keeps the untrimmed server strategy for ${languageId}`, async () => {
			const strategy = await strategyAfterAccepting(languageId);
			expect(strategy.blockMode).toBe(BlockMode.Server);
			// The three caps that make the second suggestion useless for prose.
			expect(strategy.stop).toBeUndefined();
			expect(strategy.maxTokens).toBeUndefined();
		});
	}

	// The brake is upstream's and stays on for the languages it was written for.
	// Without this, the change reads as "removed a limit" rather than "scoped it".
	it('keeps the one-line cap for code', async () => {
		const strategy = await strategyAfterAccepting('typescript');
		expect(strategy.blockMode).toBe(BlockMode.Parsing);
		expect(strategy.stop).toEqual(['\n\n']);
		expect(strategy.maxTokens).toBe(20);
	});
});
