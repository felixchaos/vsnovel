/*---------------------------------------------------------------------------------------------
 *  VS Novel — registering the Grok agent session.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../platform/extContext/common/extensionContext';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../extension/common/contributions';
import { GROK_SESSION_TYPE, GrokChatSessionContentProvider } from './sessionProvider';

/**
 * Contributes the Grok session type.
 *
 * Registration is unconditional and cheap: nothing is spawned until an author
 * actually sends a message, so a machine without the `grok` binary pays
 * nothing for this being here, and the "not installed" message arrives in the
 * one place it makes sense — the chat they just typed into.
 *
 * ## The `contributes.chatSessions` fields are switches, not description
 *
 * Each one lands on a branch in core, and getting one wrong fails silently and
 * differently. This entry was first copied from `claude-code`, whose answers
 * happen to be the opposite of ours on every count, and each wrong field cost
 * a build to find. Written down so the next one does not:
 *
 * - **`canDelegate: true`** — without it, `_enableContribution` registers
 *   neither the chat agent nor the `openNewChatSessionInPlace.<type>` command
 *   (chatSessions.contribution.ts). The type is then absent from the picker
 *   entirely, and the only trace is `Unknown agent: "<type>"` in the renderer
 *   log when something reaches for it.
 * - **`supportsAutoModel: true`** — `getSessionTypeAvailability` returns
 *   `Available` early for a type that either has models targeting it or
 *   supports the synthetic Auto model; otherwise a Free or EDU entitlement
 *   falls through to `UpgradeRequired` and the row renders greyed with an
 *   "Upgrade" badge. Ours is `true` as a statement of fact, not to dodge a
 *   paywall: the model is chosen inside the `grok` CLI (`session/new` answers
 *   with `grok-4.6` and its reasoning-effort ladder), so this session type
 *   never draws on the editor's model pool.
 * - **`capabilities.supportsImageAttachments: false`** — measured, not
 *   assumed: `initialize` answers `promptCapabilities.image: false`. Declaring
 *   `true` would put an attachment button in front of an author that cannot
 *   work.
 * - **no `requiresCopilotSignIn`** — this session needs an xAI sign-in held by
 *   the CLI, and nothing from the editor's own account.
 *
 * The picker itself only appears while `chatSessionIsEmpty`, so the way to see
 * any of this is a freshly opened, unused chat.
 */
export class GrokAgentContribution extends Disposable implements IExtensionContribution {
	public readonly id: string = 'novel-grok-agent';

	constructor(
		@ILogService logService: ILogService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
	) {
		super();

		const contentProvider = new GrokChatSessionContentProvider(logService, extensionContext.globalState);
		this._register({ dispose: () => contentProvider.dispose() });

		const participant = vscode.chat.createChatParticipant(
			GROK_SESSION_TYPE,
			contentProvider.createHandler()
		);
		participant.iconPath = new vscode.ThemeIcon('sparkle');
		this._register({ dispose: () => participant.dispose() });

		// The controller, not `registerChatSessionItemProvider`: it is what carries
		// `getChatSessionInputState`, which is asked *per session* rather than once
		// at registration. That timing is the whole reason the pickers can be
		// populated at all — at registration no agent has run and there is nothing
		// to describe.
		const controller = vscode.chat.createChatSessionItemController(
			GROK_SESSION_TYPE,
			async () => { /* no server-side session list yet; nothing to refresh */ }
		);
		this._register({ dispose: () => controller.dispose() });

		controller.getChatSessionInputState = (sessionResource, _context, _token) => {
			const { modelId, effortId } = contentProvider.selectionFor(sessionResource);
			const state = controller.createChatSessionInputState(
				contentProvider.buildOptionGroups(modelId, effortId)
			);
			state.onDidChange(() => {
				void contentProvider.applySelection(state.sessionResource, state.groups).then(modelChanged => {
					if (modelChanged) {
						// Replacing the array is how the editor is told to re-render;
						// mutating it in place is documented not to work.
						const next = contentProvider.selectionFor(state.sessionResource);
						state.groups = contentProvider.buildOptionGroups(next.modelId, next.effortId);
					}
				});
			});
			return state;
		};

		const content = vscode.chat.registerChatSessionContentProvider(
			GROK_SESSION_TYPE,
			contentProvider,
			participant
		);
		this._register({ dispose: () => content.dispose() });

		logService.info('[novel-grok] registered the Grok agent session type');
	}
}
