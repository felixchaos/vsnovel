/*---------------------------------------------------------------------------------------------
 *  VS Novel — the Kimi family reaches the writing prompt, not the coding one.
 *--------------------------------------------------------------------------------------------*/

/**
 * Same guard as grokPrompt.spec.ts. Upstream's `KimiPromptResolver` claims
 * `kimi-k2.6` and `kimi-k2.7-code` by predicate; ours must win by registration
 * order, and must additionally cover `kimi-k3` and the bare `kimi` family that
 * the upstream predicate does not match — every one of which this product ships.
 */

import { describe, expect, it } from 'vitest';
import type { IChatEndpoint } from '../../../platform/networking/common/networking';
import { PromptRegistry } from '../../../extension/prompts/node/agent/promptRegistry';
import '../../../extension/prompts/node/agent/allAgentPrompts';

function endpoint(family: string): IChatEndpoint {
	return { family, model: family, name: family } as IChatEndpoint;
}
const instantiationService = { createInstance: (Ctor: new () => unknown) => new Ctor() } as never;

async function systemPromptName(family: string): Promise<string> {
	const resolved = await PromptRegistry.resolveAllCustomizations(instantiationService, endpoint(family));
	return resolved.SystemPrompt.name;
}

describe('kimi prompt resolution', () => {

	// Every family label this product uses for a Kimi model, including the two
	// the upstream predicate matches and the ones it does not.
	it('claims every kimi the product ships', async () => {
		for (const family of ['kimi', 'kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code']) {
			expect(await systemPromptName(family), family).toBe('NovelWritingAgentPrompt');
		}
	});

	// The models upstream also claims by predicate are where registration order
	// decides the winner — the case most likely to regress on a rebase.
	it('wins over the upstream kimi coding prompt', async () => {
		expect(await systemPromptName('kimi-k2.6')).not.toBe('KimiAgentPrompt');
		expect(await systemPromptName('kimi-k2.7-code')).not.toBe('KimiAgentPrompt');
	});
});
