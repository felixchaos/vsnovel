/*---------------------------------------------------------------------------------------------
 *  VS Novel — the Grok agent, as the editor sees it.
 *--------------------------------------------------------------------------------------------*/

/**
 * Adapts a `grok agent stdio` session to the editor's chat-session API.
 *
 * This is a thin layer on purpose: everything that can be wrong about the
 * protocol is decided in `session.ts`, which is testable without a workbench.
 * What lives here is the part that can only be judged by looking at it — what
 * the author sees when the binary is missing, when they have not signed in, and
 * while a turn is streaming.
 *
 * **This is Grok's agent, not ours.** It arrives with its own system prompt,
 * its own tools and its own permission model, and none of this product's
 * writing prompts apply to it. That is inherent to the route — the credential
 * belongs to the `grok` CLI, and the CLI is the thing holding the conversation.
 * Presenting it as a separate, clearly named agent rather than as our own is
 * the honest shape, and it is why this is a chat *session* rather than a model
 * in the picker.
 */

import * as vscode from 'vscode';
import { findGrokBinary, spawnGrokAgent } from './agentProcess';
import { EFFORT_GROUP, GrokModelCatalogue, MODEL_GROUP, defaultEffort, effortsFor } from './options';
import { GrokAgentSession, GrokNotAuthenticated, PermissionRequest } from './session';

/** Where the last-seen model catalogue is remembered between launches. */
const CATALOGUE_KEY = 'novel-builder.grok.catalogue';

/** The session type and uri scheme. Must match `contributes.chatSessions`. */
export const GROK_SESSION_TYPE = 'grok';

/** Where the author can read what the agent wrote to stderr. */
export interface ProviderLog {
	info(message: string): void;
	warn(message: string): void;
}

export class GrokChatSessionContentProvider implements vscode.ChatSessionContentProvider {

	/** One agent process per chat session, keyed by the session's resource. */
	private readonly _sessions = new Map<string, GrokAgentSession>();

	private readonly _onDidChangeItems = new vscode.EventEmitter<void>();
	readonly onDidChangeChatSessionItems = this._onDidChangeItems.event;

	/**
	 * The last catalogue an agent reported.
	 *
	 * The pickers are built per session, but a session that has just been opened
	 * in a fresh window has not spoken to an agent yet. Remembering the last
	 * catalogue means the pickers are populated from the moment the input row
	 * appears, instead of only after the first message.
	 */
	private _catalogue: GrokModelCatalogue;

	constructor(
		private readonly _log: ProviderLog,
		private readonly _memento: vscode.Memento,
	) {
		this._catalogue = this._memento.get<GrokModelCatalogue>(CATALOGUE_KEY) ?? { models: [] };
	}

	provideChatSessionContent(resource: vscode.Uri): vscode.ChatSession {
		const session = this._sessions.get(resource.toString());
		const options: Record<string, string> = {};
		if (session?.currentModelId) {
			options[MODEL_GROUP] = session.currentModelId;
			const effort = session.currentEffort ?? defaultEffort(effortsFor(this._catalogue, session.currentModelId));
			if (effort) {
				options[EFFORT_GROUP] = effort;
			}
		}
		return {
			history: [],
			options,
			requestHandler: (request, _context, stream, token) =>
				this._handleRequest(resource, request, stream, token),
		};
	}

	/** The participant handler, for requests that arrive outside a resolved session. */
	createHandler(): vscode.ChatRequestHandler {
		return (request, _context, stream, token) =>
			this._handleRequest(untitledResource(), request, stream, token);
	}

	dispose(): void {
		for (const session of this._sessions.values()) {
			session.dispose();
		}
		this._sessions.clear();
		this._onDidChangeItems.dispose();
	}

	private async _handleRequest(
		resource: vscode.Uri,
		request: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<void> {
		const session = await this._sessionFor(resource, stream);
		if (!session) {
			return;
		}

		// Cancellation is a notification the agent acts on; the turn still has to
		// be awaited so the stream closes in order.
		const cancellation = token.onCancellationRequested(() => session.cancel());
		try {
			await session.prompt(
				request.prompt,
				{
					text: value => stream.markdown(value),
					thought: value => stream.thinkingProgress({ text: value, id: 'grok' }),
					progress: value => stream.progress(value),
				},
				() => token.isCancellationRequested
			);
		} catch (err) {
			// A dead agent and a refused turn read the same way to the author
			// unless the reason is shown, and the agent's own wording is better
			// than anything invented here.
			const message = err instanceof Error ? err.message : String(err);
			this._log.warn(`[novel-grok] turn failed: ${message}`);
			stream.markdown(vscode.l10n.t('The Grok agent stopped: {0}', message));
			this._sessions.get(resource.toString())?.dispose();
			this._sessions.delete(resource.toString());
		} finally {
			cancellation.dispose();
		}
	}

	/**
	 * The two pickers for one session's input row.
	 *
	 * Built per session rather than once at registration — which is what the
	 * older `provideChatSessionProviderOptions` did, and why the pickers stayed
	 * empty: at registration no agent has run, so there is no catalogue to
	 * describe, and that call never comes again.
	 *
	 * The depth group is rebuilt from whichever model is selected, because the
	 * ladders are not the same length (grok-4.6 has four rungs, grok-4.5 three).
	 * A single merged list would let an author choose a depth their model does
	 * not have, which the agent then silently ignores.
	 */
	buildOptionGroups(modelId?: string, effortId?: string): vscode.ChatSessionProviderOptionGroup[] {
		if (this._catalogue.models.length === 0) {
			return [];
		}
		const currentModel = modelId ?? this._catalogue.current ?? this._catalogue.models[0].modelId;
		const efforts = effortsFor(this._catalogue, currentModel);
		const currentEffort = effortId ?? defaultEffort(efforts);

		const modelItems = this._catalogue.models.map(model => ({
			id: model.modelId,
			name: model.name,
			description: model.description,
			default: model.modelId === currentModel,
		}));

		const groups: vscode.ChatSessionProviderOptionGroup[] = [{
			id: MODEL_GROUP,
			name: vscode.l10n.t('Model'),
			items: modelItems,
			selected: modelItems.find(item => item.id === currentModel),
		}];

		if (efforts.length > 0) {
			const effortItems = efforts.map(effort => ({
				id: effort.id,
				name: effort.label ?? effort.id,
				description: effort.description,
				default: effort.id === currentEffort,
			}));
			groups.push({
				id: EFFORT_GROUP,
				name: vscode.l10n.t('Thinking'),
				items: effortItems,
				selected: effortItems.find(item => item.id === currentEffort),
			});
		}
		return groups;
	}

	/** Apply what the author picked to the agent running that session. */
	async applySelection(resource: vscode.Uri | undefined, groups: readonly vscode.ChatSessionProviderOptionGroup[]): Promise<boolean> {
		const session = resource && this._sessions.get(resource.toString());
		if (!session) {
			return false;
		}
		const selected = (id: string) => groups.find(group => group.id === id)?.selected?.id;
		const modelId = selected(MODEL_GROUP) ?? session.currentModelId;
		if (!modelId) {
			return false;
		}
		const effort = selected(EFFORT_GROUP) ?? session.currentEffort;
		const modelChanged = modelId !== session.currentModelId;
		try {
			await session.setModel(modelId, effort);
		} catch (err) {
			this._log.warn(`[novel-grok] could not switch model: ${err instanceof Error ? err.message : String(err)}`);
		}
		// A different model brings a different ladder, so the depth picker has to
		// be rebuilt rather than left showing rungs that no longer exist.
		return modelChanged;
	}

	/** The model and depth a session is currently on, for rebuilding its pickers. */
	selectionFor(resource: vscode.Uri | undefined): { modelId?: string; effortId?: string } {
		const session = resource && this._sessions.get(resource.toString());
		return { modelId: session?.currentModelId, effortId: session?.currentEffort };
	}

	/**
	 * The agent for this chat session, started on first use.
	 *
	 * Both failure modes end here rather than as exceptions, because both have
	 * an answer the author can act on and neither is worth an error dialog.
	 */
	private async _sessionFor(
		resource: vscode.Uri,
		stream: vscode.ChatResponseStream
	): Promise<GrokAgentSession | undefined> {
		const key = resource.toString();
		const existing = this._sessions.get(key);
		if (existing) {
			return existing;
		}

		const configured = vscode.workspace.getConfiguration('novel').get<string>('grokPath');
		const binary = findGrokBinary(configured);
		if (!binary.found) {
			// Naming the command is the whole message. "Not found" without it
			// leaves a novelist with nowhere to go.
			stream.markdown(vscode.l10n.t('Grok is not installed on this computer. Install it from https://x.ai/cli, then run `grok login` once to sign in with your Grok account.'));
			this._log.warn(`[novel-grok] no binary; looked at: ${binary.searched.join(', ')}`);
			return undefined;
		}

		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
		try {
			const session = await GrokAgentSession.start({
				process: spawnGrokAgent({ binary: binary.path, cwd, log: message => this._log.info(message) }),
				cwd,
				log: this._log,
				onPermission: request => this._askPermission(request),
				onTitle: () => this._onDidChangeItems.fire(),
			});
			this._sessions.set(key, session);
			if (session.catalogue.models.length > 0) {
				this._catalogue = session.catalogue;
				void this._memento.update(CATALOGUE_KEY, this._catalogue);
			}
			return session;
		} catch (err) {
			if (err instanceof GrokNotAuthenticated) {
				stream.markdown(vscode.l10n.t('Grok is installed but not signed in. Run `grok login` in a terminal to sign in with your Grok account, then try again.'));
				return undefined;
			}
			const message = err instanceof Error ? err.message : String(err);
			this._log.warn(`[novel-grok] could not start: ${message}`);
			stream.markdown(vscode.l10n.t('The Grok agent could not start: {0}', message));
			return undefined;
		}
	}

	/**
	 * Put the agent's permission request in front of the author.
	 *
	 * A quick pick rather than a modal: the agent asks often, and a modal in the
	 * middle of writing is worse than the thing it is guarding. Dismissing it is
	 * a decision — "cancelled" — not a hang, because the agent is blocked on
	 * this answer.
	 */
	private async _askPermission(request: PermissionRequest): Promise<string | undefined> {
		if (request.options.length === 0) {
			return undefined;
		}
		const picked = await vscode.window.showQuickPick(
			request.options.map(option => ({ label: option.name, id: option.optionId })),
			{ title: request.title, placeHolder: vscode.l10n.t('The Grok agent is waiting for your decision') }
		);
		return picked?.id;
	}
}

let untitledCounter = 0;
function untitledResource(): vscode.Uri {
	return vscode.Uri.from({ scheme: GROK_SESSION_TYPE, path: `/untitled-${++untitledCounter}` });
}
