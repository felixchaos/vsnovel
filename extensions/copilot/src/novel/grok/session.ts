/*---------------------------------------------------------------------------------------------
 *  VS Novel — one conversation with a running grok agent.
 *--------------------------------------------------------------------------------------------*/

/**
 * Owns a `grok agent stdio` process, its ACP connection, and one session on it.
 *
 * The wire shapes below are not read off the documentation — they were measured
 * against `grok 1.0.5` before this file existed, because the documented table of
 * update kinds names the kinds and not their payloads, and a client written from
 * the table alone gets the nesting wrong (`params.update.sessionUpdate`, not
 * `params.sessionUpdate`) in a way that fails as a silently empty response.
 *
 * The editor is deliberately absent from this file. It streams into a
 * {@link ResponseSink}, a four-method interface the provider adapts to a real
 * `ChatResponseStream`, so the protocol can be tested without a workbench.
 */

import { AcpConnection, AcpError, methodNotFound } from './acp/connection';
import { GrokModelCatalogue, readCatalogue, setModelParams } from './options';
import { GrokAgentProcess } from './agentProcess';

/** Where a streamed turn goes. The editor side of this is one small adapter. */
export interface ResponseSink {
	/** A chunk of the answer itself. */
	text(value: string): void;
	/** A chunk of the model's reasoning. */
	thought(value: string): void;
	/** A tool started, or changed state. Rendered as progress. */
	progress(value: string): void;
}

/** What the agent needs a human to decide before it may act. */
export interface PermissionRequest {
	readonly title: string;
	readonly options: ReadonlyArray<{ readonly optionId: string; readonly name: string; readonly kind?: string }>;
}

/** Resolves to the chosen option id, or `undefined` when the author declined. */
export type PermissionResponder = (request: PermissionRequest) => Promise<string | undefined>;

export interface GrokModel {
	readonly modelId: string;
	readonly name: string;
	readonly description?: string;
}

export interface SessionLog {
	info(message: string): void;
	warn(message: string): void;
}

export interface StartOptions {
	readonly process: GrokAgentProcess;
	readonly cwd: string;
	readonly log: SessionLog;
	readonly onPermission: PermissionResponder;
	/** Called when the agent renames the session, which it does after the first turn. */
	readonly onTitle?: (title: string) => void;
}

/** The protocol version this client speaks. The agent answered 1. */
const PROTOCOL_VERSION = 1;

/**
 * Raised when the agent has no usable credential.
 *
 * Separated from every other failure because it is the only one with an action
 * attached: the author signs in. Everything else is "try again" or "look at the
 * log", and conflating them produces a sign-in button for a network blip.
 */
export class GrokNotAuthenticated extends Error {
	constructor(readonly authMethods: ReadonlyArray<{ id: string; name: string }>) {
		super('the grok agent is not signed in');
		this.name = 'GrokNotAuthenticated';
	}
}

export class GrokAgentSession {

	private _sessionId: string | undefined;
	private _sink: ResponseSink | undefined;
	private _models: GrokModel[] = [];
	private _currentModelId: string | undefined;
	private _currentEffort: string | undefined;
	private _catalogue: GrokModelCatalogue = { models: [] };
	private _title: string | undefined;

	private constructor(
		private readonly _connection: AcpConnection,
		private readonly _options: StartOptions,
	) { }

	get sessionId(): string | undefined { return this._sessionId; }
	get title(): string | undefined { return this._title; }
	get models(): readonly GrokModel[] { return this._models; }
	get currentModelId(): string | undefined { return this._currentModelId; }
	get currentEffort(): string | undefined { return this._currentEffort; }
	/** What the agent said it offers, with each model's own thinking ladder. */
	get catalogue(): GrokModelCatalogue { return this._catalogue; }

	/**
	 * Start the agent, shake hands, and open a session.
	 *
	 * `initialize` is local and free; `session/new` is where a missing
	 * credential surfaces, which is why the two are not collapsed.
	 */
	static async start(options: StartOptions): Promise<GrokAgentSession> {
		let session: GrokAgentSession;

		const connection = new AcpConnection(
			{
				write: line => options.process.write(line),
				close: () => options.process.kill(),
			},
			(method, params) => session.handleRequest(method, params),
			(method, params) => session.handleNotification(method, params),
			{ warn: message => options.log.warn(message) },
		);

		session = new GrokAgentSession(connection, options);
		options.process.onLine(chunk => connection.receive(chunk));
		options.process.onExit(reason => connection.close(reason));

		const initialized = await connection.request('initialize', {
			protocolVersion: PROTOCOL_VERSION,
			// We advertise nothing we cannot actually do. Claiming filesystem
			// support we have not implemented makes the agent delegate reads to
			// us and then wait for an answer that never comes.
			clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
		}) as { authMethods?: Array<{ id: string; name: string }> };

		try {
			const created = await connection.request('session/new', {
				cwd: options.cwd,
				mcpServers: [],
			}) as {
				sessionId?: string;
				models?: { currentModelId?: string; availableModels?: GrokModel[] };
			};
			if (!created?.sessionId) {
				throw new Error('the grok agent opened a session without giving it an id');
			}
			session._sessionId = created.sessionId;
			session._models = created.models?.availableModels ?? [];
			session._currentModelId = created.models?.currentModelId;
			session._catalogue = readCatalogue(created.models);
			options.log.info(`[novel-grok] session ${created.sessionId} on ${session._currentModelId ?? 'an unnamed model'}`);
			return session;
		} catch (err) {
			connection.close('session could not be opened');
			if (looksUnauthenticated(err)) {
				throw new GrokNotAuthenticated(initialized?.authMethods ?? []);
			}
			throw err;
		}
	}

	/**
	 * Send one turn and stream it.
	 *
	 * Resolves with the agent's stop reason once the turn is complete. Streaming
	 * happens through the sink as notifications arrive, not through the return
	 * value — `session/prompt` answers only at the end.
	 */
	async prompt(text: string, sink: ResponseSink, isCancelled: () => boolean): Promise<string> {
		if (!this._sessionId) {
			throw new Error('this session was never opened');
		}
		this._sink = sink;
		try {
			const result = await this._connection.request('session/prompt', {
				sessionId: this._sessionId,
				prompt: [{ type: 'text', text }],
			}) as { stopReason?: string };
			return result?.stopReason ?? 'end_turn';
		} finally {
			this._sink = undefined;
			if (isCancelled()) {
				this.cancel();
			}
		}
	}

	/**
	 * Switch model and/or thinking depth.
	 *
	 * One request carries both: the agent parses the depth off `_meta` on the
	 * same `session/set_model` it uses for the model, and there is no separate
	 * method for it.
	 */
	async setModel(modelId: string, effort?: string): Promise<void> {
		if (!this._sessionId) {
			return;
		}
		await this._connection.request('session/set_model', setModelParams(this._sessionId, modelId, effort));
		this._currentModelId = modelId;
		this._currentEffort = effort;
	}

	/** Ask the agent to stop the current turn. Fire and forget, as ACP defines it. */
	cancel(): void {
		if (this._sessionId) {
			this._connection.notify('session/cancel', { sessionId: this._sessionId });
		}
	}

	dispose(): void {
		this._connection.close('the session was closed');
	}

	/**
	 * Answer what the agent asks of us.
	 *
	 * Only permission is implemented. Everything else gets a proper
	 * `method not found`, which is an answer — the outcome that must never
	 * happen is silence, because the agent blocks on these.
	 */
	async handleRequest(method: string, params: unknown): Promise<unknown> {
		if (method !== 'session/request_permission') {
			throw methodNotFound(method);
		}
		const request = params as {
			toolCall?: { title?: string; rawInput?: unknown };
			options?: Array<{ optionId: string; name: string; kind?: string }>;
		};
		const chosen = await this._options.onPermission({
			title: request?.toolCall?.title ?? 'The agent wants to run a tool.',
			options: request?.options ?? [],
		});
		return chosen
			? { outcome: { outcome: 'selected', optionId: chosen } }
			: { outcome: { outcome: 'cancelled' } };
	}

	/**
	 * Route a pushed update.
	 *
	 * The nesting is the part worth stating: the kind lives at
	 * `params.update.sessionUpdate` and the text at `params.update.content.text`.
	 * Reading `params.sessionUpdate` — which is what the documentation's table
	 * reads like — matches nothing and produces an empty answer with no error.
	 */
	handleNotification(method: string, params: unknown): void {
		if (method !== 'session/update') {
			// The agent also pushes a family of `x.ai/*` notifications (model
			// lists, mcp status, queue changes). None of them are needed to hold
			// a conversation, and ignoring an unknown one must stay harmless.
			return;
		}
		const update = (params as { update?: { sessionUpdate?: string; content?: { text?: string }; title?: string } })?.update;
		if (!update?.sessionUpdate) {
			return;
		}
		switch (update.sessionUpdate) {
			case 'agent_message_chunk':
				if (update.content?.text) {
					this._sink?.text(update.content.text);
				}
				return;
			case 'agent_thought_chunk':
				if (update.content?.text) {
					this._sink?.thought(update.content.text);
				}
				return;
			case 'tool_call':
			case 'tool_call_update': {
				const tool = update as unknown as { title?: string; status?: string };
				if (tool.title) {
					this._sink?.progress(tool.status ? `${tool.title} (${tool.status})` : tool.title);
				}
				return;
			}
			case 'session_info_update':
				if (update.title) {
					this._title = update.title;
					this._options.onTitle?.(update.title);
				}
				return;
			default:
				// `user_message_chunk`, `available_commands_update`, `plan` and
				// whatever a later agent adds. Silence is the right response to
				// an update this client has no place to put.
				return;
		}
	}
}

/**
 * Whether a failure means "sign in" rather than "try again".
 *
 * Matched on the message as well as the code because ACP does not reserve a
 * code for it and the agent answers `session/new` with an ordinary error. A
 * false positive costs a sign-in prompt the author can dismiss; a false
 * negative costs them a support conversation about a session that will never
 * open.
 */
function looksUnauthenticated(err: unknown): boolean {
	if (err instanceof AcpError && err.code === -32000) {
		return true;
	}
	const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
	return message.includes('auth') || message.includes('not signed in') || message.includes('log in');
}
