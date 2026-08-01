/*---------------------------------------------------------------------------------------------
 *  VS Novel — the Grok family claims the shared writing prompt.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grok is different from DeepSeek in one way that decides how it is registered.
 *
 * Upstream ships an xAI prompt (xAIPrompts.tsx) whose `XAIPromptResolver` claims
 * the family by predicate — `isXAiFamily`, i.e. `family.startsWith('grok')`. The
 * registry checks every predicate resolver before it looks at a single prefix
 * (promptRegistry.ts), and among predicate resolvers the first registered wins.
 * So a prefix registration would lose to the upstream one, and this resolver must
 * therefore also be a predicate and must be registered *before* xAIPrompts.
 *
 * That ordering is not left to chance: allAgentPrompts.ts imports this file ahead
 * of './xAIPrompts', and grokPrompt.spec.ts asserts a `grok-*` family resolves
 * here and not to the upstream coding prompt — so a rebase that reorders the
 * imports fails a test rather than silently shipping a coding agent.
 *
 * The upstream `family.startsWith('grok')` is left in place on purpose: it still
 * decides Grok's client capabilities (multi-replace editing and the rest), which
 * we want. Only the prompt is ours.
 */

import { IChatEndpoint } from '../../platform/networking/common/networking';
import { NovelReminderInstructions } from './novelReminderInstructions';
import {
	IAgentPrompt, PromptRegistry, ReminderInstructionsConstructor, SystemPrompt,
} from '../../extension/prompts/node/agent/promptRegistry';
import { NovelWritingAgentPrompt } from './novelWritingAgentPrompt';

class GrokPromptResolver implements IAgentPrompt {
	static readonly familyPrefixes: readonly string[] = [];

	static matchesModel(endpoint: IChatEndpoint): boolean {
		return endpoint.family.startsWith('grok');
	}

	resolveSystemPrompt(_endpoint: IChatEndpoint): SystemPrompt | undefined {
		return NovelWritingAgentPrompt;
	}

	resolveReminderInstructions(_endpoint: IChatEndpoint): ReminderInstructionsConstructor | undefined {
		return NovelReminderInstructions;
	}
}

PromptRegistry.registerPrompt(GrokPromptResolver);
