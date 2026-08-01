/*---------------------------------------------------------------------------------------------
 *  VS Novel — the DeepSeek family claims the shared writing prompt.
 *--------------------------------------------------------------------------------------------*/

/**
 * DeepSeek has no upstream family — GitHub does not serve it — so `family:
 * 'deepseek'` matches no registered prefix and, left alone, falls through to
 * `DefaultAgentPrompt`, whose every instruction assumes a codebase. This claims
 * the family for the shared prose prompt instead.
 *
 * Registered by prefix rather than by a `matchesModel` predicate: nothing
 * upstream claims `deepseek`, so a prefix is enough and keeps the rule visible in
 * the same table as every other family. Grok and Kimi need a predicate because an
 * upstream resolver already claims them — see grokPrompt.tsx, kimiPrompt.tsx.
 */

import { IChatEndpoint } from '../../platform/networking/common/networking';
import { NovelReminderInstructions } from './novelReminderInstructions';
import {
	IAgentPrompt, PromptRegistry, ReminderInstructionsConstructor, SystemPrompt,
} from '../../extension/prompts/node/agent/promptRegistry';
import { NovelWritingAgentPrompt } from './novelWritingAgentPrompt';

class DeepSeekPromptResolver implements IAgentPrompt {
	static readonly familyPrefixes: readonly string[] = ['deepseek'];

	resolveSystemPrompt(_endpoint: IChatEndpoint): SystemPrompt | undefined {
		return NovelWritingAgentPrompt;
	}

	resolveReminderInstructions(_endpoint: IChatEndpoint): ReminderInstructionsConstructor | undefined {
		return NovelReminderInstructions;
	}
}

PromptRegistry.registerPrompt(DeepSeekPromptResolver);
