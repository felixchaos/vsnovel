/*---------------------------------------------------------------------------------------------
 *  VS Novel — the Grok family reaches the writing prompt, not the coding one.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is the test the whole registration order exists for.
 *
 * Upstream's `XAIPromptResolver` claims `grok-*` by predicate, and predicate
 * resolvers are checked before prefixes and decided by registration order. If a
 * rebase reorders the imports in allAgentPrompts.ts so that './xAIPrompts' loads
 * before our grokPrompt, Grok silently reverts to `DefaultGrokAgentPrompt` — a
 * coding agent with its opening sentence swapped — and nothing else notices.
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

describe('grok prompt resolution', () => {

	it('claims the model this product ships', async () => {
		expect(await systemPromptName('grok-4.5')).toBe('NovelWritingAgentPrompt');
	});

	// The exact regression the import order guards: our predicate must win over
	// the upstream xAI predicate that also matches grok.
	it('wins over the upstream xAI coding prompt', async () => {
		expect(await systemPromptName('grok-4.5')).not.toBe('DefaultGrokAgentPrompt');
	});

	// Prefix-style match, so a future grok-5 is covered the day it is added.
	it('covers future grok models', async () => {
		expect(await systemPromptName('grok-5-preview')).toBe('NovelWritingAgentPrompt');
	});
});
