/*---------------------------------------------------------------------------------------------
 *  VS Novel — the Kimi family claims the shared writing prompt.
 *--------------------------------------------------------------------------------------------*/

/**
 * Same shape as grokPrompt.tsx, and for the same reason: upstream's
 * `KimiPromptResolver` claims the family by predicate (`isKimiFamily`), and a
 * predicate resolver beats any prefix and is decided by registration order. So
 * this is a predicate too, registered before './kimiPrompts'.
 *
 * The predicate here is broader than the upstream one on purpose. `isKimiFamily`
 * matches only `kimi-k2.6` and `kimi-k2.7-code`; this product also ships
 * `kimi-k3` and labels its offerings with the bare family `kimi`, and every one
 * of those must land on the writing prompt rather than on `DefaultAgentPrompt`.
 * `family.startsWith('kimi')` covers all of them.
 *
 * kimiPrompt.spec.ts asserts each shipped Kimi family resolves here and not to
 * the upstream coding prompt, so the import order this depends on is guarded.
 */

import { IChatEndpoint } from '../../platform/networking/common/networking';
import { DefaultReminderInstructions } from '../../extension/prompts/node/agent/defaultAgentInstructions';
import {
	IAgentPrompt, PromptRegistry, ReminderInstructionsConstructor, SystemPrompt,
} from '../../extension/prompts/node/agent/promptRegistry';
import { NovelWritingAgentPrompt } from './novelWritingAgentPrompt';

class KimiPromptResolver implements IAgentPrompt {
	static readonly familyPrefixes: readonly string[] = [];

	static matchesModel(endpoint: IChatEndpoint): boolean {
		return endpoint.family.startsWith('kimi');
	}

	resolveSystemPrompt(_endpoint: IChatEndpoint): SystemPrompt | undefined {
		return NovelWritingAgentPrompt;
	}

	resolveReminderInstructions(_endpoint: IChatEndpoint): ReminderInstructionsConstructor | undefined {
		return DefaultReminderInstructions;
	}
}

PromptRegistry.registerPrompt(KimiPromptResolver);
