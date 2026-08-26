/*---------------------------------------------------------------------------------------------
 *  VS Novel — deciding what to do with the agent's permission requests.
 *--------------------------------------------------------------------------------------------*/

/**
 * Turns a `session/request_permission` into either an answer or a confirmation
 * for the editor to show.
 *
 * The first version of this asked with `vscode.window.showQuickPick`. That is a
 * dropdown at the top of the window, outside the chat and outside the editor's
 * tool-confirmation machinery entirely — which is why none of the auto-approve
 * settings had any effect on it, why there was no "always allow", and why the
 * approval appeared somewhere other than the conversation that caused it. The
 * fix is not a better dropdown; it is to stop having one.
 *
 * Two routes, and they answer different questions:
 *
 * 1. **The editor's confirmation** (`vscode_get_confirmation`) renders inline
 *    in the response, and core applies its own auto-approve to it — but only
 *    while `allowAutoConfirm` is set, and core sets that to `false` the moment
 *    a tool passes custom buttons (it cannot know which of them means yes).
 *    So this maps the agent's option list down to plain approve/deny instead
 *    of forwarding it. Losing "reject and tell Grok what to do differently" as
 *    a *button* costs nothing — the author types that either way — and buys
 *    the auto-approve that was the complaint.
 * 2. **Autopilot** answers without asking at all. Measured against the `grok`
 *    CLI's own client, which does exactly this: pick the option whose `kind`
 *    is `allow_once` and reply. Note what it does *not* do — it never picks
 *    `allow_always` on the author's behalf, because that decision outlives the
 *    turn. Neither do we.
 *
 * Shapes measured against `grok 1.0.5`: a shell approval arrives as
 * `toolCall.kind: "execute"` with `rawInput.command`, and options
 * `[{optionId:"allow-once",kind:"allow_once"}, {optionId:"reject-once",kind:"reject_once"}]`.
 */

export interface PermissionOption {
	readonly optionId: string;
	readonly name: string;
	readonly kind?: string;
}

/** A permission request, in the parts this module reads. */
export interface PermissionRequest {
	readonly title: string;
	readonly options: readonly PermissionOption[];
	/** The agent's tool kind — `execute` means a shell command. */
	readonly toolKind?: string;
	/** The command line, when there is one. */
	readonly command?: string;
	/** The agent's own one-line explanation of what it is about to do. */
	readonly description?: string;
}

/** What the editor should be asked to show. Mirrors `vscode_get_confirmation`'s input. */
export interface ConfirmationRequest {
	readonly title: string;
	readonly message: string;
	readonly confirmationType: 'basic' | 'terminal';
	readonly terminalCommand?: string;
}

export type ApprovalPlan =
	/** Answer immediately, without troubling the author. */
	| { readonly kind: 'auto'; readonly optionId: string }
	/** Ask, then answer with `approveId` or `rejectId`. */
	| { readonly kind: 'ask'; readonly confirmation: ConfirmationRequest; readonly approveId: string; readonly rejectId?: string }
	/** Nothing sensible to do — the agent still has to be told. */
	| { readonly kind: 'cancel' };

function byKind(options: readonly PermissionOption[], kind: string): PermissionOption | undefined {
	return options.find(option => option.kind === kind);
}

/**
 * Read a permission request off the wire.
 *
 * Kept next to the planner so the one place that knows the agent's nesting is
 * the one place tested against a recorded request.
 */
export function readPermissionRequest(params: unknown, fallbackTitle: string): PermissionRequest {
	const raw = params as {
		toolCall?: { title?: string; kind?: string; rawInput?: { command?: unknown; description?: unknown } };
		options?: PermissionOption[];
	} | undefined;
	const rawInput = raw?.toolCall?.rawInput;
	return {
		title: raw?.toolCall?.title ?? fallbackTitle,
		options: Array.isArray(raw?.options) ? raw.options : [],
		toolKind: raw?.toolCall?.kind,
		command: typeof rawInput?.command === 'string' ? rawInput.command : undefined,
		description: typeof rawInput?.description === 'string' ? rawInput.description : undefined,
	};
}

/**
 * Decide how to answer.
 *
 * `autoApprove` is the author's setting. It only ever reaches for `allow_once`;
 * a request that offers no such option (the agent uses these for decisions it
 * considers irreversible) still goes in front of them.
 */
export function planApproval(request: PermissionRequest, autoApprove: boolean): ApprovalPlan {
	if (request.options.length === 0) {
		return { kind: 'cancel' };
	}

	const allowOnce = byKind(request.options, 'allow_once');
	if (autoApprove && allowOnce) {
		return { kind: 'auto', optionId: allowOnce.optionId };
	}

	// Falling back to the first option is deliberate: an agent version that
	// renames its kinds must still be answerable, and the first option is the
	// one it lists as the affirmative.
	const approve = allowOnce ?? request.options[0];
	const reject = byKind(request.options, 'reject_once') ?? request.options.find(option => option.optionId !== approve.optionId);

	const isTerminal = request.toolKind === 'execute' && !!request.command;
	return {
		kind: 'ask',
		approveId: approve.optionId,
		rejectId: reject?.optionId,
		confirmation: isTerminal
			? {
				title: request.title,
				// The command is shown by the terminal confirmation itself;
				// repeating it in the message renders it twice.
				message: request.description ?? request.title,
				confirmationType: 'terminal',
				terminalCommand: request.command,
			}
			: {
				title: request.title,
				message: request.description ?? request.title,
				confirmationType: 'basic',
			},
	};
}

/** The reply body for a chosen option, or for a refusal. */
export function permissionOutcome(optionId: string | undefined): unknown {
	return optionId
		? { outcome: { outcome: 'selected', optionId } }
		: { outcome: { outcome: 'cancelled' } };
}
