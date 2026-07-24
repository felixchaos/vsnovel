/*---------------------------------------------------------------------------------------------
 *  VS Novel — novel-specific replacements for Copilot's shared prompt slots.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement } from '@vscode/prompt-tsx';
import { IPromptEndpoint } from '../../extension/prompts/node/base/promptRenderer';

/**
 * Why this file exists.
 *
 * `PromptRegistry` resolves exactly one prompt resolver per model — registering
 * another one would *replace* the per-family tuning Microsoft ships, which is
 * the thing we most want to keep. But two of the six slots it fills
 * (`CopilotIdentityRulesClass`, `SafetyRulesClass`) fall back to a single shared
 * class each. Replacing the content of those two shared classes reaches every
 * model without touching a single per-family `SystemPrompt`.
 *
 * The upstream files therefore delegate here and stay one or two lines away from
 * their original form; everything we actually author lives in this directory,
 * which upstream does not have and so can never conflict on rebase.
 */

/** Identity. Replaces the "GitHub Copilot" / programming-assistant framing. */
export class NovelIdentityRules extends PromptElement {

	constructor(
		props: any,
		@IPromptEndpoint private readonly promptEndpoint: IPromptEndpoint
	) {
		super(props);
	}

	render() {
		return (
			<>
				You are a writing assistant for novelists, working with an author inside their manuscript.<br />
				When asked about the model you are using, state that you are using {this.promptEndpoint.name}.<br />
				Follow the author's instructions carefully and to the letter.
			</>
		);
	}
}

/**
 * Safety rules.
 *
 * Two clauses from the upstream version are deliberately gone:
 *
 * - *"or completely irrelevant to software engineering"* — scoped the assistant
 *   to code. For a novel tool it refuses the entire product.
 *
 * - *"Keep your answers short and impersonal."* — this one is subtler. It is
 *   scoped to chat replies, not to prose written into files, so it is not
 *   wrong per se. But an author discussing a scene needs a collaborator, not a
 *   terse one, and "impersonal" is the opposite of what the work calls for.
 *   Brevity while narrating tool calls is preserved by the per-family prompts,
 *   which we leave alone.
 *
 * The content-policy clause is kept. Fiction covers violence and moral
 * complexity, and the models we route to have their own training on this; a
 * refusal budget in the metering layer handles repeated probing, which is a
 * usage-pattern problem rather than a prompt problem.
 */
export class NovelSafetyRules extends PromptElement {
	render() {
		return (
			<>
				Avoid content that violates copyrights.<br />
				If you are asked to generate content that is harmful, hateful, racist, or sexist, only respond with "Sorry, I can't assist with that."<br />
			</>
		);
	}
}
