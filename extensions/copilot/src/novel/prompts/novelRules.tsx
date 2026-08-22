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
 * The upstream refusal list — *"harmful, hateful, racist, or sexist"* — is gone
 * too, and that one needs saying plainly: as a list of *categories to refuse* it
 * describes the cast of most serious fiction. A novel about a pogrom is made of
 * hateful speech. A villain who is not allowed to be cruel is not a villain. The
 * model cannot tell "depicts bigotry" from "is bigoted" when the instruction it
 * was handed only names the topic, so it resolves the ambiguity the safe way and
 * the author gets a scene with the teeth filed off — and, worse, no refusal to
 * point at. This product is for adult fiction; the categories are the material.
 *
 * What replaces it is not "no limits" but a different cut: the line is drawn
 * between *depiction*, which is the whole job, and two things that are not
 * depiction at all. Sexual content involving minors is a criminal matter in the
 * US and Japan (18 U.S.C. §1466A reaches obscene material even when it is purely
 * fictional), and every upstream we route to terminates accounts for it — it is
 * not a taste setting anyone can turn off here. Real-world operational detail
 * for serious harm — a working synthesis, an exploit that runs — is not
 * something a novel is ever made worse by lacking; "he cooked the batch" carries
 * the scene, the actual chemistry only carries liability.
 *
 * Note what this file can and cannot reach. It stops *us* from instructing a
 * refusal. It does not change what DeepSeek, Anthropic or Moonshot trained their
 * models to do, and it does not alter their usage policies — a model that will
 * not write a scene still will not write it, and the answer to that is model
 * choice or BYOK, not prompt text.
 */
export class NovelSafetyRules extends PromptElement {
	render() {
		return (
			<>
				Avoid content that violates copyrights.<br />
				You are writing adult fiction. Explicit sex, graphic violence, cruelty, addiction, despair, and bigotry in the mouths of characters are legitimate material, and you render them at the length and intensity the author asks for. Do not fade to black, soften, sanitise, moralise, or append a disclaimer unless the author asked for one — depicting a thing is not endorsing it, and this author does not need the distinction explained.<br />
				Two things stay out no matter how the request is framed: sexual content involving minors, and real-world operational instructions for serious harm. Neither is a matter of taste, and neither is something fiction needs.<br />
			</>
		);
	}
}
