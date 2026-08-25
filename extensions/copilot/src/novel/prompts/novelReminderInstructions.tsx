/*---------------------------------------------------------------------------------------------
 *  VS Novel — the reminders that sit next to the author's message.
 *--------------------------------------------------------------------------------------------*/

/**
 * The system prompt is read once, at the top of a conversation that then grows
 * to forty turns of manuscript. This slot is rendered *immediately before the
 * author's message*, every turn (agentPrompt.tsx: "Critical reminders that are
 * effective when repeated right next to the user message"), which is the only
 * place a behaviour that keeps slipping can be restated cheaply enough to
 * repeat.
 *
 * Two behaviours earn a place here, both observed failing in production with
 * the system-prompt wording already in place (2026-08-01, Kimi K3, agent mode):
 *
 *   - Questions written into the reply as prose. The model produced exactly the
 *     right content — three decisions, each with options and a recommendation —
 *     as a numbered list in chat. In that channel it ends the turn and waits;
 *     through the tool it renders as buttons and the answer arrives inside the
 *     same turn. The difference is a pause versus a stop, and it is invisible
 *     to the model unless something says so.
 *   - Stopping after one step to report progress.
 *
 * Unconditional on purpose. The question tool is a core built-in registered
 * with no `when` clause and listed as non-deferred (toolDeferralService.ts), so
 * it is present whenever the agent runs; and the failure mode of naming a tool
 * that somehow is not there — the model asks in prose — is exactly what happens
 * without this text anyway.
 *
 * Appended rather than substituted, since 2026-08-25. This class used to be the
 * whole slot for three families, so it had to re-emit getEditingReminder itself
 * or those models would have lost the edit-tool wording. It is now rendered
 * after the per-family reminder, which already emits that wording tuned for the
 * model in question — Gemini's asks for the strong replace-string hint, and
 * re-emitting a second copy with the hint off would argue with it. So only the
 * two behaviours above remain here.
 */

import { PromptElement, PromptSizing } from '@vscode/prompt-tsx';
import { ReminderInstructionsProps } from '../../extension/prompts/node/agent/defaultAgentInstructions';
import { ToolName } from '../../extension/tools/common/toolNames';

export class NovelReminderInstructions extends PromptElement<ReminderInstructionsProps> {
	async render(state: void, sizing: PromptSizing) {
		return <>
			When you need a decision that is genuinely the author's, ask it with {ToolName.CoreAskQuestions}, with the concrete options you are weighing and which one you would pick. Asking in your reply instead ends the turn; the tool answers inside it.<br />
			Everything you can settle by reading the manuscript or the story bible, settle that way instead of asking.<br />
			Otherwise carry on to the end of what was asked. Do not stop after one step to report progress.<br />
		</>;
	}
}
