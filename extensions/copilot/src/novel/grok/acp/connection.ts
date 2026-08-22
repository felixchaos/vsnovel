/*---------------------------------------------------------------------------------------------
 *  VS Novel — the JSON-RPC connection to an ACP agent.
 *--------------------------------------------------------------------------------------------*/

/**
 * Newline-delimited JSON-RPC 2.0, which is what ACP speaks over stdio.
 *
 * This class knows nothing about Grok, sessions, or the editor: it moves
 * messages and it never lets the far side wait forever. Four things here are
 * the difference between a working agent and one that appears to hang, and each
 * of them is a bug this shape makes impossible rather than unlikely.
 *
 * 1. **The agent sends requests to us, not only responses.** Permission prompts
 *    and filesystem reads arrive as JSON-RPC *requests* with an id, and the
 *    agent blocks until it gets an answer. A client that only listens for
 *    responses deadlocks the first time the agent asks for anything — with no
 *    error anywhere, because from the agent's side the client is simply slow.
 *    So every incoming request is answered, including the ones we do not
 *    implement, which get a proper `method not found` rather than silence.
 * 2. **A chunk is not a line.** stdout arrives in arbitrary pieces; one read can
 *    hold half a message or three of them. Parsing per chunk works in testing,
 *    where messages are small, and breaks on the first long tool result.
 * 3. **A malformed line must not kill the connection.** One unparseable message
 *    is one lost message. Tearing down the session over it loses the author's
 *    work in progress.
 * 4. **Every pending request is settled on close.** When the process dies, the
 *    promises waiting on it have to reject, or the editor shows a spinner that
 *    never resolves and the author has no way to tell it apart from a slow
 *    model.
 */

/** How the connection reaches the far side. The process wrapper supplies these. */
export interface AcpChannel {
	/** Write one framed message. The connection appends the newline itself. */
	write(line: string): void;
	/** Stop the far side. Called when the connection is disposed. */
	close(): void;
}

/** A JSON-RPC error as it arrives on the wire. */
export interface AcpErrorBody {
	code: number;
	message: string;
	data?: unknown;
}

export class AcpError extends Error {
	constructor(readonly code: number, message: string, readonly data?: unknown) {
		super(message);
		this.name = 'AcpError';
	}
}

/** Answers a request the agent made of us. Rejecting turns into a JSON-RPC error. */
export type AcpRequestHandler = (method: string, params: unknown) => Promise<unknown>;

/** Receives a notification the agent pushed. Never answered. */
export type AcpNotificationHandler = (method: string, params: unknown) => void;

/** Somewhere for a line we could not make sense of, and for protocol noise. */
export interface AcpLogger {
	warn(message: string): void;
	trace?(message: string): void;
}

/** JSON-RPC's own code for a method the peer does not implement. */
const METHOD_NOT_FOUND = -32601;
/** JSON-RPC's code for a handler that threw. */
const INTERNAL_ERROR = -32603;

/**
 * A line longer than this is treated as a runaway rather than buffered.
 *
 * Without a ceiling, a far side that writes without newlines — a crash dump, a
 * binary blob on the wrong stream — grows this buffer until the extension host
 * runs out of memory, and the symptom is the whole editor dying rather than one
 * agent misbehaving.
 */
const MAX_LINE_BYTES = 32 * 1024 * 1024;

interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	readonly method: string;
}

export class AcpConnection {

	private _nextId = 1;
	private readonly _pending = new Map<number, Pending>();
	private _buffer = '';
	private _closed = false;

	constructor(
		private readonly _channel: AcpChannel,
		private readonly _onRequest: AcpRequestHandler,
		private readonly _onNotification: AcpNotificationHandler,
		private readonly _log: AcpLogger,
	) { }

	/** Send a request and wait for its answer. */
	request(method: string, params?: unknown): Promise<unknown> {
		if (this._closed) {
			return Promise.reject(new Error(`the agent connection is closed (${method})`));
		}
		const id = this._nextId++;
		const promise = new Promise<unknown>((resolve, reject) => {
			this._pending.set(id, { resolve, reject, method });
		});
		this._send({ jsonrpc: '2.0', id, method, params });
		return promise;
	}

	/** Send a notification. Nothing comes back, including errors. */
	notify(method: string, params?: unknown): void {
		if (this._closed) {
			return;
		}
		this._send({ jsonrpc: '2.0', method, params });
	}

	/**
	 * Feed whatever arrived on the far side's stdout.
	 *
	 * Chunk boundaries are meaningless; only newlines are. A trailing partial
	 * line is kept for the next chunk.
	 */
	receive(chunk: string): void {
		this._buffer += chunk;
		if (this._buffer.length > MAX_LINE_BYTES) {
			this._log.warn(`[acp] dropped ${this._buffer.length} bytes with no newline in them`);
			this._buffer = '';
			return;
		}
		let index: number;
		while ((index = this._buffer.indexOf('\n')) >= 0) {
			const line = this._buffer.slice(0, index).trim();
			this._buffer = this._buffer.slice(index + 1);
			if (line) {
				this._handleLine(line);
			}
		}
	}

	/**
	 * Settle everything and stop the far side.
	 *
	 * `reason` reaches the author through whichever request was in flight, so it
	 * should say what happened rather than that something did.
	 */
	close(reason: string): void {
		if (this._closed) {
			return;
		}
		this._closed = true;
		const pending = [...this._pending.values()];
		this._pending.clear();
		for (const entry of pending) {
			entry.reject(new Error(`${reason} (waiting on ${entry.method})`));
		}
		this._channel.close();
	}

	private _send(message: unknown): void {
		this._channel.write(JSON.stringify(message));
	}

	private _handleLine(line: string): void {
		let message: {
			id?: number | string;
			method?: string;
			params?: unknown;
			result?: unknown;
			error?: AcpErrorBody;
		};
		try {
			message = JSON.parse(line);
		} catch {
			// One lost message, not a lost session. The agent writes human-facing
			// diagnostics to stderr, so a non-JSON line here is noise we did not
			// ask for rather than something the author needs.
			this._log.warn(`[acp] ignored a line that was not JSON: ${line.slice(0, 200)}`);
			return;
		}

		if (message.method !== undefined && message.id !== undefined) {
			void this._answer(message.id, message.method, message.params);
			return;
		}
		if (message.method !== undefined) {
			try {
				this._onNotification(message.method, message.params);
			} catch (err) {
				// A throwing notification handler must not take the connection
				// with it; the agent is not waiting on this one.
				this._log.warn(`[acp] notification handler for ${message.method} threw: ${errorText(err)}`);
			}
			return;
		}
		if (message.id !== undefined) {
			this._settle(message.id, message.result, message.error);
			return;
		}
		this._log.warn('[acp] ignored a message with neither method nor id');
	}

	private async _answer(id: number | string, method: string, params: unknown): Promise<void> {
		try {
			const result = await this._onRequest(method, params);
			this._send({ jsonrpc: '2.0', id, result });
		} catch (err) {
			// Answering with an error is still answering. The one outcome that
			// must never happen is no reply at all.
			const code = err instanceof AcpError ? err.code : INTERNAL_ERROR;
			this._send({ jsonrpc: '2.0', id, error: { code, message: errorText(err) } });
		}
	}

	private _settle(id: number | string, result: unknown, error: AcpErrorBody | undefined): void {
		const key = typeof id === 'number' ? id : Number(id);
		const entry = this._pending.get(key);
		if (!entry) {
			// A late answer to something already settled, or an id we never sent.
			// Neither is worth ending the session over.
			this._log.warn(`[acp] ignored an answer for unknown request ${id}`);
			return;
		}
		this._pending.delete(key);
		if (error) {
			entry.reject(new AcpError(error.code, error.message, error.data));
		} else {
			entry.resolve(result);
		}
	}
}

/** The error every handler above raises for a method we do not implement. */
export function methodNotFound(method: string): AcpError {
	return new AcpError(METHOD_NOT_FOUND, `this client does not implement ${method}`);
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
