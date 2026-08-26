/*---------------------------------------------------------------------------------------------
 *  VS Novel — rebuilding a Grok conversation from the agent's own replay.
 *--------------------------------------------------------------------------------------------*/

/**
 * Folds the `session/update` notifications an agent replays after
 * `session/load` back into chat turns.
 *
 * This exists because the provider used to answer `provideChatSessionContent`
 * with `history: []`, unconditionally. Every conversation therefore looked
 * empty the moment the window was reloaded — not lost on the agent's side,
 * which had it all along, just never asked for.
 *
 * `agentCapabilities.loadSession` is `true` on `grok 1.0.5`, and a
 * `session/load` without `_meta.noReplay` pushes the entire conversation back
 * as ordinary `session/update` notifications before it answers. Measured
 * against a real two-turn session, the replay differs from the live stream in
 * one way that matters: it arrives **coalesced** — one `agent_message_chunk`
 * holding a whole message rather than a hundred holding a token each. The fold
 * below accumulates either way, so the same function serves both.
 *
 * Thoughts are dropped on purpose. They are worth watching as they happen and
 * worth nothing on re-read, and keeping them triples the length of a restored
 * transcript for an author who is looking for what they wrote.
 */

export type HistoryPart =
	| { readonly kind: 'markdown'; readonly text: string }
	| { readonly kind: 'tool'; readonly id: string; readonly title: string; readonly status?: string };

export type HistoryTurn =
	| { readonly kind: 'request'; readonly text: string }
	| { readonly kind: 'response'; readonly parts: readonly HistoryPart[] };

interface RawUpdate {
	sessionUpdate?: string;
	content?: { text?: string };
	title?: string;
	status?: string;
	toolCallId?: string;
}

/** Pull the `update` payload out of a `session/update` notification's params. */
export function updateOf(params: unknown): unknown {
	return (params as { update?: unknown } | undefined)?.update;
}

class Fold {
	readonly turns: HistoryTurn[] = [];
	private _request: string | undefined;
	private _parts: HistoryPart[] = [];
	private readonly _toolIndex = new Map<string, number>();

	/**
	 * A chunk of what the author said.
	 *
	 * Only an open *response* is flushed here, never an open request: chunks of
	 * one message arrive back to back, and closing the request on each of them
	 * turns a sentence into one turn per token.
	 */
	request(text: string): void {
		this._flushResponse();
		this._request = (this._request ?? '') + text;
	}

	markdown(text: string): void {
		this.closeRequest();
		const last = this._parts[this._parts.length - 1];
		if (last?.kind === 'markdown') {
			this._parts[this._parts.length - 1] = { kind: 'markdown', text: last.text + text };
		} else {
			this._parts.push({ kind: 'markdown', text });
		}
	}

	/**
	 * A tool call, or a later state of one already seen.
	 *
	 * Keyed by id and updated in place: the agent sends `tool_call` and then
	 * several `tool_call_update`s for the same call, and appending each one
	 * would render the same command four times with only the last being true.
	 */
	tool(id: string, title: string | undefined, status: string | undefined): void {
		this.closeRequest();
		const at = this._toolIndex.get(id);
		if (at === undefined) {
			if (!title) {
				return;
			}
			this._toolIndex.set(id, this._parts.length);
			this._parts.push({ kind: 'tool', id, title, status });
			return;
		}
		const existing = this._parts[at] as Extract<HistoryPart, { kind: 'tool' }>;
		this._parts[at] = { kind: 'tool', id, title: title ?? existing.title, status: status ?? existing.status };
	}

	closeRequest(): void {
		if (this._request !== undefined) {
			this.turns.push({ kind: 'request', text: this._request });
			this._request = undefined;
		}
	}

	closeResponse(): void {
		this.closeRequest();
		this._flushResponse();
	}

	private _flushResponse(): void {
		if (this._parts.length > 0) {
			this.turns.push({ kind: 'response', parts: this._parts });
			this._parts = [];
			this._toolIndex.clear();
		}
	}

	finish(): HistoryTurn[] {
		this.closeResponse();
		return this.turns;
	}
}

/**
 * Fold a sequence of replayed updates into turns.
 *
 * Unknown kinds are skipped rather than treated as an error: the agent pushes a
 * family of bookkeeping updates (`available_commands_update`, `model_changed`,
 * `response_completed`, a set of `x.ai/*` notifications) that carry nothing a
 * transcript needs, and a later agent version will add more.
 */
export function foldReplay(updates: Iterable<unknown>): HistoryTurn[] {
	const fold = new Fold();
	for (const raw of updates) {
		const update = raw as RawUpdate | undefined;
		switch (update?.sessionUpdate) {
			case 'user_message_chunk':
				if (update.content?.text) {
					fold.request(update.content.text);
				}
				break;
			case 'agent_message_chunk':
				if (update.content?.text) {
					fold.markdown(update.content.text);
				}
				break;
			case 'tool_call':
			case 'tool_call_update':
				if (update.toolCallId) {
					fold.tool(update.toolCallId, update.title, update.status);
				}
				break;
			case 'turn_completed':
				fold.closeResponse();
				break;
			default:
				break;
		}
	}
	return fold.finish();
}
