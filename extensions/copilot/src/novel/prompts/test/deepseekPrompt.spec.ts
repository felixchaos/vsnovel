/*---------------------------------------------------------------------------------------------
 *  VS Novel — the DeepSeek family actually claims its prompt.
 *--------------------------------------------------------------------------------------------*/

/**
 * These are resolution tests, not text tests.
 *
 * The failure this guards against is silent: an unclaimed family does not error,
 * it falls back to `DefaultAgentPrompt` and the author simply talks to a coding
 * agent. Nothing in the UI says which prompt was chosen, so the only place the
 * choice can be observed is here.
 *
 * The prose itself is shared by every family and tested once, against the file
 * that holds it — see novelWritingAgentPrompt.spec.ts. This file only proves the
 * DeepSeek family reaches it.
 */

import { describe, expect, it } from 'vitest';
import type { IChatEndpoint } from '../../../platform/networking/common/networking';
import { PromptRegistry } from '../../../extension/prompts/node/agent/promptRegistry';

// Registers every upstream family alongside ours, so these tests see the same
// resolver list the product does — including the matchers that run before any
// prefix is considered.
import '../../../extension/prompts/node/agent/allAgentPrompts';

/**
 * Enough of an endpoint for resolution.
 *
 * All three identity fields are set to the same value on purpose: the predicate
 * matchers do not agree on which one names the model — some read `family`, some
 * `model`, and `isVSCModelE` reads `name` as well — so a stub that omits any of
 * them throws inside a matcher rather than resolving.
 */
function endpoint(family: string): IChatEndpoint {
	return { family, model: family, name: family } as IChatEndpoint;
}

/**
 * `resolveAllCustomizations` instantiates the resolver through the DI container.
 * Ours takes no dependencies, so a container that only knows how to `new` is
 * enough and keeps this a unit test.
 */
const instantiationService = { createInstance: (Ctor: new () => unknown) => new Ctor() } as never;

async function systemPromptFor(family: string): Promise<{ name: string }> {
	const resolved = await PromptRegistry.resolveAllCustomizations(instantiationService, endpoint(family));
	return resolved.SystemPrompt;
}

describe('deepseek prompt resolution', () => {

	it('claims the models this product actually ships', async () => {
		for (const family of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
			expect((await systemPromptFor(family)).name, family).toBe('NovelWritingAgentPrompt');
		}
	});

	// The registry checks every `matchesModel` resolver before it looks at a
	// single prefix, so registering a prefix does not by itself guarantee it wins.
	// Kimi, MiniMax, xAI, Z.ai and family H all match by predicate.
	it('is not intercepted by a predicate-matched family', async () => {
		expect((await systemPromptFor('deepseek-v4-pro')).name).not.toBe('KimiAgentPrompt');
	});

	// The whole point: before this registration, both models landed here.
	// Compared by name rather than by identity: importing DefaultAgentPrompt here
	// closes an import cycle through the registry and yields undefined, which
	// would make `not.toBe` pass for the wrong reason.
	it('no longer falls back to the default coding prompt', async () => {
		expect((await systemPromptFor('deepseek-v4-flash')).name).not.toBe('DefaultAgentPrompt');
		// A family we do not serve still does, which is what makes the assertion
		// above meaningful rather than vacuous.
		expect((await systemPromptFor('some-unclaimed-family')).name).toBe('DefaultAgentPrompt');
	});

	// Prefix rather than exact id, so a future deepseek-v5 is covered on the day
	// it is added to the catalog instead of silently reverting to the default.
	it('covers future deepseek models by prefix', async () => {
		expect((await systemPromptFor('deepseek-v5-preview')).name).toBe('NovelWritingAgentPrompt');
	});

	// Domain-neutral: it renders tool mechanics only. Reused deliberately rather
	// than copied, so upstream tool changes reach this family too.
	it('reuses the default reminder instructions', async () => {
		const resolved = await PromptRegistry.resolveAllCustomizations(instantiationService, endpoint('deepseek-v4-pro'));
		expect(resolved.ReminderInstructionsClass.name).toBe('DefaultReminderInstructions');
	});
});
