/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement } from '@vscode/prompt-tsx';
import type { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { CopilotIdentityRules } from '../base/copilotIdentity';
import { SafetyRules } from '../base/safetyRules';
import { DefaultAgentPrompt, DefaultAgentPromptProps, DefaultReminderInstructions, DefaultToolReferencesHint, ReminderInstructionsProps, ToolReferencesHintProps } from './defaultAgentInstructions';

export type SystemPrompt = new (props: DefaultAgentPromptProps, ...args: any[]) => PromptElement<DefaultAgentPromptProps>;

export type ReminderInstructionsConstructor = new (props: ReminderInstructionsProps, ...args: any[]) => PromptElement<ReminderInstructionsProps>;

export type ToolReferencesHintConstructor = new (props: ToolReferencesHintProps, ...args: any[]) => PromptElement<ToolReferencesHintProps>;

export type CopilotIdentityRulesConstructor = new (props: BasePromptElementProps, ...args: any[]) => PromptElement<BasePromptElementProps>;

export type SafetyRulesConstructor = new (props: BasePromptElementProps, ...args: any[]) => PromptElement<BasePromptElementProps>;

export interface IAgentPrompt {
	resolveSystemPrompt(endpoint: IChatEndpoint): SystemPrompt | undefined;
	resolveReminderInstructions?(endpoint: IChatEndpoint): ReminderInstructionsConstructor | undefined;
	resolveToolReferencesHint?(endpoint: IChatEndpoint): ToolReferencesHintConstructor | undefined;
	resolveCopilotIdentityRules?(endpoint: IChatEndpoint): CopilotIdentityRulesConstructor | undefined;
	resolveSafetyRules?(endpoint: IChatEndpoint): SafetyRulesConstructor | undefined;
	resolveUserQueryTagName?(endpoint: IChatEndpoint): string | undefined;
}

export interface IAgentPromptCtor {
	readonly familyPrefixes: readonly string[];
	matchesModel?(endpoint: IChatEndpoint): Promise<boolean> | boolean;
	new(...args: any[]): IAgentPrompt;
}

export type AgentPromptClass = IAgentPromptCtor & (new (...args: any[]) => IAgentPrompt);

type PromptWithMatcher = IAgentPromptCtor & {
	matchesModel: (endpoint: IChatEndpoint) => Promise<boolean> | boolean;
};

export interface AgentPromptCustomizations {
	readonly SystemPrompt: SystemPrompt;
	readonly ReminderInstructionsClass: ReminderInstructionsConstructor;
	readonly ToolReferencesHintClass: ToolReferencesHintConstructor;
	readonly CopilotIdentityRulesClass: CopilotIdentityRulesConstructor;
	readonly SafetyRulesClass: SafetyRulesConstructor;
	readonly userQueryTagName?: string;
}

export const PromptRegistry = new class {
	private readonly promptsWithMatcher: PromptWithMatcher[] = [];
	private readonly familyPrefixList: { prefix: string; prompt: IAgentPromptCtor }[] = [];

	// NOVEL-BUILDER: an additive slot, alongside the per-family resolvers above.
	//
	// The registry resolves exactly one prompt per model, which is right for what
	// it was built for: the per-family tunings are alternatives to each other. But
	// this product also has instructions that belong to every model equally —
	// where the story bible lives, that a search must be told which chapter is
	// being written, how a translation glossary binds — and expressing those
	// through the existing slot means replacing a family's tuning to add to it.
	// That is the trade this list exists to avoid: what is registered here is
	// appended after whichever prompt won, so Copilot's per-model prompt
	// engineering survives and the product's own instructions still reach every
	// model. Global rather than per-endpoint, because none of it varies by model.
	private readonly appendedSystemInstructions: SystemPrompt[] = [];
	private readonly appendedReminderInstructions: ReminderInstructionsConstructor[] = [];

	get additionalSystemInstructions(): readonly SystemPrompt[] {
		return this.appendedSystemInstructions;
	}

	get additionalReminderInstructions(): readonly ReminderInstructionsConstructor[] {
		return this.appendedReminderInstructions;
	}

	// NOVEL-BUILDER: see appendedSystemInstructions.
	registerAdditionalInstructions(instructions: { system?: SystemPrompt; reminder?: ReminderInstructionsConstructor }): void {
		if (instructions.system) {
			this.appendedSystemInstructions.push(instructions.system);
		}
		if (instructions.reminder) {
			this.appendedReminderInstructions.push(instructions.reminder);
		}
	}

	registerPrompt(prompt: IAgentPromptCtor): void {
		if (prompt.matchesModel) {
			this.promptsWithMatcher.push(prompt as PromptWithMatcher);
		}

		for (const prefix of prompt.familyPrefixes) {
			this.familyPrefixList.push({ prefix, prompt });
		}
	}

	private async getPromptResolver(
		endpoint: IChatEndpoint
	): Promise<IAgentPromptCtor | undefined> {

		for (const prompt of this.promptsWithMatcher) {
			const matches = await prompt.matchesModel(endpoint);
			if (matches) {
				return prompt;
			}
		}

		for (const { prefix, prompt } of this.familyPrefixList) {
			if (endpoint.family.startsWith(prefix)) {
				return prompt;
			}
		}

		return undefined;
	}

	/**
	 * Resolves all customizations from the prompt registry for a given endpoint.
	 * This is the main method to call to get all per-model customizations in one place.
	 * @param instantiationService The instantiation service to create the agent prompt instance
	 * @param endpoint The chat endpoint to resolve customizations for
	 * @returns All resolved customizations for the endpoint
	 */
	async resolveAllCustomizations(
		instantiationService: IInstantiationService,
		endpoint: IChatEndpoint,
	): Promise<AgentPromptCustomizations> {
		const promptResolverCtor = await this.getPromptResolver(endpoint);
		const agentPrompt = promptResolverCtor ? instantiationService.createInstance(promptResolverCtor) : undefined;

		return {
			SystemPrompt: agentPrompt?.resolveSystemPrompt(endpoint) ?? DefaultAgentPrompt,
			ReminderInstructionsClass: agentPrompt?.resolveReminderInstructions?.(endpoint) ?? DefaultReminderInstructions,
			ToolReferencesHintClass: agentPrompt?.resolveToolReferencesHint?.(endpoint) ?? DefaultToolReferencesHint,
			CopilotIdentityRulesClass: agentPrompt?.resolveCopilotIdentityRules?.(endpoint) ?? CopilotIdentityRules,
			SafetyRulesClass: agentPrompt?.resolveSafetyRules?.(endpoint) ?? SafetyRules,
			userQueryTagName: agentPrompt?.resolveUserQueryTagName?.(endpoint) ?? 'userRequest',
		};
	}
}();
