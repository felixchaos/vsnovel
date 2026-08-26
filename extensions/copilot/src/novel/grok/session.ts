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
 * {@link ResponseSink}, a small interface the provider adapts to a real
 * `ChatResponseStream`, so the protocol can be tested without a workbench.
 *
 * ## A session outlives its process
 *
 * The agent stores conversations itself and answers `agentCapabilities.
 * loadSession: true`. So the durable identity of a conversation is the agent's
 * `sessionId`, not this object and not the child process — {@link resume}
 * attaches to one that already exists, and the agent replays the whole
 * transcript before answering. Treating the process as the conversation is what
 * made a window reload, or one failed turn, look like amnesia.
 */

import { AcpConnection, AcpError } from './acp/connection';
import { GrokModelCatalogue, readCatalogue, setModelParams } from './options';
import { GrokAgentProcess } from './agentProcess';
import { PermissionRequest, permissionOutcome, readPermissionRequest } from './approval';
import { PromptBlock } from './prompt';

export type { PermissionRequest } from './approval';

/** Where a streamed turn goes. The editor side of this is one small adapter. */
export interface ResponseSink {
	/** A chunk of the answer itself. */
	text(value: string): void;
	/** A chunk of the model's reasoning. */
	thought(value: string): void;
	/** A tool started, or changed state. Rendered as progress. */
	progress(value: string): void;
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
	/**
	 * An agent-side session to attach to instead of opening a new one.
	 *
	 * When set, the agent replays the conversation before answering, and
	 * {@link GrokAgentSession.replay} holds what it sent.
	 */
	readonly resumeSessionId?: string;
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

/** Raised when the agent no longer has the session we were told to resume. */
export class GrokSessionGone extends Error {
	constructor(readonly sessionId: string) {
		super(`the grok agent no longer has session ${sessionId}`);
		this.name = 'GrokSessionGone';
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
	private _alive = true;
	/** Updates captured while the agent was replaying a resumed conversation. */
	private _replay: unknown[] | undefined;
	private _replayed: unknown[] = [];

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
	/** False once the process or the connection has gone. */
	get alive(): boolean { return this._alive; }
	/** The conversation the agent replayed when this session was resumed. */
	get replay(): readonly unknown[] { return this._replayed; }

	/**
	 * Start the agent, shake hands, and open or attach to a session.
	 *
	 * `initialize` is local and free; the session call is where a missing
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
		options.process.onExit(reason => {
			session._alive = false;
			connection.close(reason);
		});

		const initialized = await connection.request('initialize', {
			protocolVersion: PROTOCOL_VERSION,
			// We advertise nothing we cannot actually do. Claiming filesystem
			// support we have not implemented makes the agent delegate reads to
			// us and then wait for an answer that never comes.
			clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
		}) as { authMethods?: Array<{ id: string; name: string }> };

		try {
			if (options.resumeSessionId) {
				await session._resume(options.resumeSessionId);
			} else {
				await session._open();
			}
			options.log.info(`[novel-grok] session ${session._sessionId} on ${session._currentModelId ?? 'an unnamed model'}`);
			return session;
		} catch (err) {
			session._alive = false;
			connection.close('session could not be opened');
			if (looksUnauthenticated(err)) {
				throw new GrokNotAuthenticated(initialized?.authMethods ?? []);
			}
			throw err;
		}
	}

	private async _open(): Promise<void> {
		const created = await this._connection.request('session/new', {
			cwd: this._options.cwd,
			mcpServers: [],
		}) as { sessionId?: string; models?: unknown };
		if (!created?.sessionId) {
			throw new Error('the grok agent opened a session without giving it an id');
		}
		this._sessionId = created.sessionId;
		this._adoptModels(created.models);
	}

	/**
	 * Attach to a conversation the agent already has.
	 *
	 * The replay arrives as ordinary `session/update` notifications *before*
	 * `session/load` answers, so capture is armed around the request and closed
	 * when it resolves. Anything that arrives afterwards is live traffic and
	 * must not be folded into the transcript a second time.
	 */
	private async _resume(sessionId: string): Promise<void> {
		this._sessionId = sessionId;
		this._replay = [];
		try {
			const loaded = await this._connection.request('session/load', {
				sessionId,
				cwd: this._options.cwd,
				mcpServers: [],
			}) as { models?: unknown };
			this._replayed = this._replay;
			this._adoptModels(loaded?.models);
		} catch (err) {
			this._sessionId = undefined;
			if (err instanceof AcpError && !looksUnauthenticated(err)) {
				// The agent prunes old sessions, and an author who deleted one
				// out from under us is not an error to shout about — the caller
				// opens a fresh one.
				throw new GrokSessionGone(sessionId);
			}
			throw err;
		} finally {
			this._replay = undefined;
		}
	}

	private _adoptModels(models: unknown): void {
		const shape = models as { currentModelId?: string; availableModels?: GrokModel[] } | undefined;
		this._models = shape?.availableModels ?? [];
		this._currentModelId = shape?.currentModelId;
		this._catalogue = readCatalogue(models);
	}

	/**
	 * Send one turn and stream it.
	 *
	 * Resolves with the agent's stop reason once the turn is complete. Streaming
	 * happens through the sink as notifications arrive, not through the return
	 * value — `session/prompt` answers only at the end.
	 */
	async prompt(blocks: readonly PromptBlock[], sink: ResponseSink, isCancelled: () => boolean): Promise<string> {
		if (!this._sessionId) {
			throw new Error('this session was never opened');
		}
		this._sink = sink;
		try {
			const result = await this._connection.request('session/prompt', {
				sessionId: this._sessionId,
				prompt: blocks,
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
		this._alive = false;
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
			throw new AcpError(-32601, `this client does not implement ${method}`);
		}
		const request = readPermissionRequest(params, 'The agent wants to run a tool.');
		return permissionOutcome(await this._options.onPermission(request));
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
		if (this._replay) {
			// Replaying: this is transcript, not a turn in progress. It must not
			// be streamed into whatever response happens to be open.
			this._replay.push(update);
			if (update.sessionUpdate === 'session_info_update' && update.title) {
				this._title = update.title;
			}
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
