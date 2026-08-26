/*---------------------------------------------------------------------------------------------
 *  VS Novel — the Grok agent, as the editor sees it.
 *--------------------------------------------------------------------------------------------*/

/**
 * Adapts a `grok agent stdio` session to the editor's chat-session API.
 *
 * This is a thin layer on purpose: everything that can be wrong about the
 * protocol is decided in `session.ts`, and everything that can be wrong about a
 * turn's content is decided in `prompt.ts`, `history.ts` and `approval.ts` —
 * all four testable without a workbench. What lives here is the wiring, and the
 * part that can only be judged by looking at it.
 *
 * **This is Grok's agent, not ours.** It arrives with its own system prompt,
 * its own tools and its own permission model, and none of this product's
 * writing prompts apply to it. That is inherent to the route — the credential
 * belongs to the `grok` CLI, and the CLI is the thing holding the conversation.
 * Presenting it as a separate, clearly named agent rather than as our own is
 * the honest shape, and it is why this is a chat *session* rather than a model
 * in the picker.
 *
 * ## What a conversation is
 *
 * The agent owns the conversation and identifies it with a `sessionId`. The
 * editor owns a chat session and identifies it with a resource uri. The only
 * job of this file is to keep those two in step:
 *
 * - one resource ⇒ one agent session, remembered across window reloads;
 * - a process that died is not a conversation that ended — reconnect and
 *   `session/load` the same id;
 * - the transcript comes back from the agent, which had it all along.
 *
 * The first version of this file did none of that. It minted a fresh
 * `untitled-N` resource on every participant call, so each message opened a new
 * agent session; it answered `history: []` unconditionally; and it dropped the
 * session on any failed turn. All three read to an author as the model losing
 * its memory, which is the one explanation that is not true.
 */

import * as vscode from 'vscode';
import { CancellationToken } from '../../util/vs/base/common/cancellation';
import { IToolsService } from '../../extension/tools/common/toolsService';
import { ToolName } from '../../extension/tools/common/toolNames';
import { findGrokBinary, spawnGrokAgent } from './agentProcess';
import { EFFORT_GROUP, GrokModelCatalogue, MODEL_GROUP, defaultEffort, effortsFor } from './options';
import { GrokAgentSession, GrokNotAuthenticated, GrokSessionGone } from './session';
import { PermissionRequest, planApproval } from './approval';
import { PromptAttachment, buildPromptBlocks } from './prompt';
import { HistoryPart, HistoryTurn, foldReplay } from './history';

/** Where the last-seen model catalogue is remembered between launches. */
const CATALOGUE_KEY = 'novel-builder.grok.catalogue';

/** Where each chat session's agent-side session id is remembered. */
const SESSIONS_KEY = 'novel-builder.grok.sessions';

/** The session type and uri scheme. Must match `contributes.chatSessions`. */
export const GROK_SESSION_TYPE = 'grok';

/** The setting that turns every permission prompt into an automatic yes. */
const AUTO_APPROVE_SETTING = 'grok.autoApprove';

/** What we remember about a conversation between windows. */
interface RememberedSession {
	readonly sessionId: string;
	readonly cwd: string;
	readonly title?: string;
}

/** Where the author can read what the agent wrote to stderr. */
export interface ProviderLog {
	info(message: string): void;
	warn(message: string): void;
}

export class GrokChatSessionContentProvider implements vscode.ChatSessionContentProvider {

	/** One agent process per chat session, keyed by the session's resource. */
	private readonly _sessions = new Map<string, GrokAgentSession>();

	/** The transcript of each chat session, as far as this window knows it. */
	private readonly _history = new Map<string, HistoryTurn[]>();

	/** In-flight starts, so two quick messages do not race two processes. */
	private readonly _starting = new Map<string, Promise<GrokAgentSession | undefined>>();

	/**
	 * The invocation token of the turn currently running, per session.
	 *
	 * A permission request arrives out of band — as a JSON-RPC request from the
	 * agent, not as a return value — so the token that ties a confirmation to
	 * the running turn has to be parked somewhere the responder can reach. Keyed
	 * by session because two chats can be answering at once; one slot per
	 * session is enough, because one agent runs one turn at a time.
	 */
	private readonly _toolTokens = new Map<string, vscode.ChatParticipantToolToken>();

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
		private readonly _globalState: vscode.Memento,
		private readonly _workspaceState: vscode.Memento,
		private readonly _toolsService: IToolsService | undefined,
	) {
		this._catalogue = this._globalState.get<GrokModelCatalogue>(CATALOGUE_KEY) ?? { models: [] };
	}

	/**
	 * Describe a session the editor is opening.
	 *
	 * A session we have never heard of is empty and cheap. One we remember is
	 * worth the cost of starting the agent here rather than on the next
	 * keystroke: the transcript only exists on the agent's side, and the author
	 * opened this session in order to read it.
	 */
	async provideChatSessionContent(resource: vscode.Uri): Promise<vscode.ChatSession> {
		const key = resource.toString();
		const remembered = this._remembered()[key];
		if (remembered && !this._history.has(key)) {
			// Failure here is not fatal: the session still accepts a new turn,
			// it just opens without its past. Saying so beats a broken editor.
			await this._sessionFor(resource, undefined).catch(err => {
				this._log.warn(`[novel-grok] could not restore ${remembered.sessionId}: ${err instanceof Error ? err.message : String(err)}`);
			});
		}

		const session = this._sessions.get(key);
		const options: Record<string, string> = {};
		if (session?.currentModelId) {
			options[MODEL_GROUP] = session.currentModelId;
			const effort = session.currentEffort ?? defaultEffort(effortsFor(this._catalogue, session.currentModelId));
			if (effort) {
				options[EFFORT_GROUP] = effort;
			}
		}
		return {
			title: session?.title ?? remembered?.title,
			history: toChatTurns(this._history.get(key) ?? []),
			options,
			requestHandler: (request, _context, stream, token) =>
				this._handleRequest(request, stream, token),
		};
	}

	/**
	 * The participant handler.
	 *
	 * It reads the session off the request rather than inventing one. The
	 * counter this used to increment is the single line that cost the most:
	 * every message became its own conversation, and nothing anywhere said so.
	 */
	createHandler(): vscode.ChatRequestHandler {
		return (request, _context, stream, token) => this._handleRequest(request, stream, token);
	}

	dispose(): void {
		for (const session of this._sessions.values()) {
			session.dispose();
		}
		this._sessions.clear();
		this._onDidChangeItems.dispose();
	}

	private async _handleRequest(
		request: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<void> {
		const resource = request.sessionResource;
		const key = resource.toString();
		const session = await this._sessionFor(resource, stream);
		if (!session) {
			return;
		}

		const attachments = await this._resolveAttachments(request, token);
		const { blocks, degraded } = buildPromptBlocks(request.prompt, attachments);
		for (const item of degraded) {
			// Silence here is the failure mode that started all of this: the
			// author believes the agent read their setting bible, and the answer
			// they get is indistinguishable from one where it disagreed.
			stream.warning(item.reason === 'too-large'
				? vscode.l10n.t('“{0}” was too large to send inline. Grok has been given a link and can open it with your permission.', item.name)
				: vscode.l10n.t('“{0}” could not be read, so Grok was given a link to it instead.', item.name));
		}

		const parts: HistoryPart[] = [];
		const record = (part: HistoryPart) => {
			const last = parts[parts.length - 1];
			if (part.kind === 'markdown' && last?.kind === 'markdown') {
				parts[parts.length - 1] = { kind: 'markdown', text: last.text + part.text };
			} else {
				parts.push(part);
			}
		};

		// Cancellation is a notification the agent acts on; the turn still has to
		// be awaited so the stream closes in order.
		const cancellation = token.onCancellationRequested(() => session.cancel());
		this._toolTokens.set(key, request.toolInvocationToken);
		try {
			await session.prompt(
				blocks,
				{
					text: value => { stream.markdown(value); record({ kind: 'markdown', text: value }); },
					thought: value => stream.thinkingProgress({ text: value, id: 'grok' }),
					progress: value => stream.progress(value),
				},
				() => token.isCancellationRequested
			);
			this._remember(key, request.prompt, parts, session);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._log.warn(`[novel-grok] turn failed: ${message}`);
			stream.warning(vscode.l10n.t('The Grok agent stopped: {0}', message));
			// The conversation is *not* dropped here. It lives on the agent's
			// side under an id we have written down, so the next turn either
			// reuses this process or reconnects and `session/load`s it. Deleting
			// it — which is what this used to do — turned one network blip into
			// amnesia the author could not explain.
			if (!session.alive) {
				this._sessions.delete(key);
			}
		} finally {
			this._toolTokens.delete(key);
			cancellation.dispose();
		}
	}

	/**
	 * Read the author's attachments so they can ride along with the turn.
	 *
	 * Everything that fails here degrades to a link rather than to nothing:
	 * a file the agent can open on request is worth much more than an attachment
	 * that silently evaporated.
	 */
	private async _resolveAttachments(request: vscode.ChatRequest, token: vscode.CancellationToken): Promise<PromptAttachment[]> {
		const attachments: PromptAttachment[] = [];
		for (const reference of request.references ?? []) {
			if (token.isCancellationRequested) {
				break;
			}
			const value = reference.value;

			if (typeof value === 'string') {
				attachments.push({ uri: `attachment:${reference.name}`, name: reference.name, text: value, mimeType: 'text/plain' });
				continue;
			}

			if (value instanceof vscode.Location) {
				const text = await this._readRange(value.uri, value.range);
				attachments.push({
					uri: value.uri.toString(),
					name: reference.name,
					text,
					range: { startLine: value.range.start.line + 1, endLine: value.range.end.line + 1 },
				});
				continue;
			}

			if (value instanceof vscode.Uri) {
				attachments.push({ uri: value.toString(), name: reference.name, text: await this._readFile(value) });
				continue;
			}

			// Images and the other binary reference kinds. The agent answered
			// `promptCapabilities.image: false`, so there is nothing to send.
			this._log.info(`[novel-grok] skipped attachment ${reference.name}: not text`);
		}
		return attachments;
	}

	private async _readFile(uri: vscode.Uri): Promise<string | undefined> {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			// A NUL in the first kilobyte is the cheap, reliable signal that this
			// is not prose. Decoding it anyway produces replacement characters
			// that cost context and say nothing.
			if (bytes.subarray(0, 1024).includes(0)) {
				return undefined;
			}
			return new TextDecoder('utf-8').decode(bytes);
		} catch (err) {
			this._log.warn(`[novel-grok] could not read ${uri.toString()}: ${err instanceof Error ? err.message : String(err)}`);
			return undefined;
		}
	}

	private async _readRange(uri: vscode.Uri, range: vscode.Range): Promise<string | undefined> {
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			return document.getText(range);
		} catch {
			return this._readFile(uri);
		}
	}

	/** Append one completed turn to what this window knows, and persist the id. */
	private _remember(key: string, prompt: string, parts: readonly HistoryPart[], session: GrokAgentSession): void {
		const turns = this._history.get(key) ?? [];
		turns.push({ kind: 'request', text: prompt });
		if (parts.length > 0) {
			turns.push({ kind: 'response', parts: [...parts] });
		}
		this._history.set(key, turns);
		this._persist(key, session);
	}

	private _remembered(): Record<string, RememberedSession> {
		return this._workspaceState.get<Record<string, RememberedSession>>(SESSIONS_KEY) ?? {};
	}

	private _persist(key: string, session: GrokAgentSession): void {
		if (!session.sessionId) {
			return;
		}
		const all = { ...this._remembered() };
		all[key] = { sessionId: session.sessionId, cwd: workspaceCwd(), title: session.title };
		void this._workspaceState.update(SESSIONS_KEY, all);
	}

	private _forget(key: string): void {
		const all = { ...this._remembered() };
		if (all[key]) {
			delete all[key];
			void this._workspaceState.update(SESSIONS_KEY, all);
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
	 * The agent for this chat session, started or reconnected on demand.
	 *
	 * `stream` is where the two actionable failures are reported. When it is
	 * absent the caller is restoring a transcript rather than answering an
	 * author, and those failures belong in the log instead.
	 */
	private async _sessionFor(
		resource: vscode.Uri,
		stream: vscode.ChatResponseStream | undefined
	): Promise<GrokAgentSession | undefined> {
		const key = resource.toString();
		const existing = this._sessions.get(key);
		if (existing?.alive) {
			return existing;
		}
		if (existing) {
			// The process is gone but the conversation is not; drop the husk and
			// let the code below reconnect to the same agent-side session.
			this._sessions.delete(key);
		}

		const inFlight = this._starting.get(key);
		if (inFlight) {
			return inFlight;
		}
		const started = this._start(key, stream).finally(() => this._starting.delete(key));
		this._starting.set(key, started);
		return started;
	}

	private async _start(key: string, stream: vscode.ChatResponseStream | undefined): Promise<GrokAgentSession | undefined> {
		const configured = vscode.workspace.getConfiguration('novel').get<string>('grokPath');
		const binary = findGrokBinary(configured);
		if (!binary.found) {
			// Naming the command is the whole message. "Not found" without it
			// leaves a novelist with nowhere to go.
			stream?.markdown(vscode.l10n.t('Grok is not installed on this computer. Install it from https://x.ai/cli, then run `grok login` once to sign in with your Grok account.'));
			this._log.warn(`[novel-grok] no binary; looked at: ${binary.searched.join(', ')}`);
			return undefined;
		}

		const remembered = this._remembered()[key];
		const cwd = remembered?.cwd ?? workspaceCwd();
		try {
			const session = await this._connect(key, binary.path, cwd, remembered?.sessionId);
			this._sessions.set(key, session);
			if (remembered?.sessionId && session.replay.length > 0) {
				this._history.set(key, foldReplay(session.replay));
			}
			if (session.catalogue.models.length > 0) {
				this._catalogue = session.catalogue;
				void this._globalState.update(CATALOGUE_KEY, this._catalogue);
			}
			this._persist(key, session);
			return session;
		} catch (err) {
			if (err instanceof GrokSessionGone) {
				// The agent pruned it, or the author deleted it. Start clean
				// rather than refusing to work — but say so, because the
				// transcript above the input box is about to stop matching what
				// the agent knows.
				this._log.warn(`[novel-grok] ${err.message}; opening a new one`);
				this._forget(key);
				this._history.delete(key);
				stream?.warning(vscode.l10n.t('Grok no longer has this conversation, so this message starts a new one.'));
				return this._start(key, stream);
			}
			if (err instanceof GrokNotAuthenticated) {
				stream?.markdown(vscode.l10n.t('Grok is installed but not signed in. Run `grok login` in a terminal to sign in with your Grok account, then try again.'));
				return undefined;
			}
			const message = err instanceof Error ? err.message : String(err);
			this._log.warn(`[novel-grok] could not start: ${message}`);
			stream?.markdown(vscode.l10n.t('The Grok agent could not start: {0}', message));
			return undefined;
		}
	}

	private _connect(key: string, binary: string, cwd: string, resumeSessionId: string | undefined): Promise<GrokAgentSession> {
		return GrokAgentSession.start({
			process: spawnGrokAgent({ binary, cwd, log: message => this._log.info(message) }),
			cwd,
			log: this._log,
			onPermission: request => this._askPermission(key, request),
			onTitle: () => this._onDidChangeItems.fire(),
			resumeSessionId,
		});
	}

	/**
	 * Put the agent's permission request in front of the author — in the chat.
	 *
	 * This used to be a `showQuickPick`, which is a dropdown at the top of the
	 * window: outside the conversation that caused it, and outside the editor's
	 * tool-confirmation machinery, so no auto-approve setting could ever reach
	 * it. Going through the editor's own confirmation tool fixes both at once,
	 * and is what the upstream Copilot CLI session does with the same problem.
	 *
	 * The invocation token is what ties a confirmation to the running turn. It
	 * is stored per session by {@link _handleRequest}'s caller rather than
	 * threaded through the protocol layer, because `session.ts` must not know
	 * that an editor exists.
	 */
	private async _askPermission(key: string, request: PermissionRequest): Promise<string | undefined> {
		const autoApprove = vscode.workspace.getConfiguration('novel').get<boolean>(AUTO_APPROVE_SETTING) === true;
		const plan = planApproval(request, autoApprove);
		if (plan.kind === 'cancel') {
			return undefined;
		}
		if (plan.kind === 'auto') {
			this._log.info(`[novel-grok] auto-approved: ${request.title}`);
			return plan.optionId;
		}

		const toolInvocationToken = this._toolTokens.get(key);
		if (!this._toolsService || !toolInvocationToken) {
			// No turn to hang a confirmation on. Refusing is the safe answer and
			// the agent is told rather than left waiting.
			this._log.warn('[novel-grok] a permission request arrived with no turn to show it in');
			return undefined;
		}

		try {
			const result = await this._toolsService.invokeTool(
				ToolName.CoreConfirmationTool,
				{ input: plan.confirmation, toolInvocationToken },
				CancellationToken.None
			);
			const first = result.content.at(0);
			const answered = first instanceof vscode.LanguageModelTextPart ? first.value.toLowerCase() : '';
			return answered === 'yes' ? plan.approveId : plan.rejectId;
		} catch (err) {
			this._log.warn(`[novel-grok] confirmation failed: ${err instanceof Error ? err.message : String(err)}`);
			return plan.rejectId;
		}
	}

}

/** The folder the agent runs in. Its own tools resolve relative paths against this. */
function workspaceCwd(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

/**
 * Turn a folded transcript into the turns the editor renders.
 *
 * Tool calls become a one-line note rather than a rich invocation: the editor's
 * tool-invocation parts want an id and an input schema this agent's tools do not
 * share, and a line saying what ran is what an author re-reading a chapter
 * actually needs.
 */
function toChatTurns(turns: readonly HistoryTurn[]): (vscode.ChatRequestTurn | vscode.ChatResponseTurn2)[] {
	const out: (vscode.ChatRequestTurn | vscode.ChatResponseTurn2)[] = [];
	for (const turn of turns) {
		if (turn.kind === 'request') {
			out.push(new vscode.ChatRequestTurn2(turn.text, undefined, [], GROK_SESSION_TYPE, [], undefined, undefined, undefined, undefined) as vscode.ChatRequestTurn);
			continue;
		}
		const parts = turn.parts.map(part => part.kind === 'markdown'
			? new vscode.ChatResponseMarkdownPart(part.text)
			: new vscode.ChatResponseMarkdownPart(`\n\`\`\`\n${part.title}${part.status ? ` — ${part.status}` : ''}\n\`\`\`\n`));
		if (parts.length > 0) {
			out.push(new vscode.ChatResponseTurn2(parts, {}, GROK_SESSION_TYPE));
		}
	}
	return out;
}
