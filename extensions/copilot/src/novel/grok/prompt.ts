/*---------------------------------------------------------------------------------------------
 *  VS Novel — turning a chat request into ACP prompt content.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds the `prompt` array of a `session/prompt` request.
 *
 * The first version of this module did not exist: the provider sent
 * `[{ type: 'text', text: request.prompt }]` and nothing else. That is the
 * whole reason attachments appeared to vanish — an author drags 设定集.md into
 * the chat, the editor happily accepts it (`supportsFileAttachments: true` is
 * declared), and not one byte of it reaches the agent. Nothing reports this:
 * the agent answers a question it was never given the material for, so it
 * reads as the model being forgetful rather than as a client dropping data.
 *
 * The shapes here were measured against `grok 1.0.5`, not read off the spec:
 *
 * - `initialize` answers `promptCapabilities.embeddedContext: true`, and an
 *   embedded `{ type: 'resource', resource: { uri, mimeType, text } }` block
 *   does reach the model — verified by putting a nonce in one and asking for
 *   it back with tools forbidden.
 * - `resource_link` is accepted too, but it is only a pointer: the agent has
 *   to spend a tool call (and a permission prompt) to follow it. So it is the
 *   fallback for things too large to embed, never the default.
 * - `image` is refused (`promptCapabilities.image: false`), which is why the
 *   session type declares no image attachments.
 */

/** An ACP prompt content block, in the subset this client sends. */
export type PromptBlock =
	| { readonly type: 'text'; readonly text: string }
	| { readonly type: 'resource_link'; readonly uri: string; readonly name: string }
	| { readonly type: 'resource'; readonly resource: { readonly uri: string; readonly mimeType?: string; readonly text: string } };

/** One thing the author attached, already resolved to text where that was possible. */
export interface PromptAttachment {
	/** A `file://` uri. Identity for de-duplication, and what the agent sees. */
	readonly uri: string;
	/** What the editor called it. Used for the link fallback and the notice. */
	readonly name: string;
	/** The content, when we could read it. Absent means "we could not". */
	readonly text?: string;
	readonly mimeType?: string;
	/** Set when the author attached a selection rather than a whole file. */
	readonly range?: { readonly startLine: number; readonly endLine: number };
}

export interface BuiltPrompt {
	readonly blocks: readonly PromptBlock[];
	/**
	 * Attachments that were sent as links instead of content, and why.
	 *
	 * Surfaced to the author rather than swallowed: "the agent did not read
	 * your setting bible" and "the agent read it and disagreed" look identical
	 * in the answer, and only one of them is worth telling them about.
	 */
	readonly degraded: readonly { readonly name: string; readonly reason: 'too-large' | 'unreadable' }[];
}

/**
 * How much attached text may ride along with one turn.
 *
 * grok-4.6 reports a 500k-token context, so these are not tight; they exist
 * because a novelist's workspace contains files that are megabytes of prose,
 * and an accidental attach of one of those would otherwise push the whole
 * conversation out of the window on the *following* turn — the failure would
 * land somewhere other than where it was caused.
 */
export const MAX_EMBEDDED_BYTES_PER_FILE = 256 * 1024;
export const MAX_EMBEDDED_BYTES_TOTAL = 1024 * 1024;

function byteLength(text: string): number {
	// The corpus is Chinese and Japanese; counting UTF-16 units here would
	// under-count by a factor of three and the cap would not be the cap.
	return Buffer.byteLength(text, 'utf8');
}

/**
 * Assemble the blocks for one turn.
 *
 * Order matters to the reader on the far side: the author's own words first,
 * then the material. The reverse buries the question under the setting bible.
 */
export function buildPromptBlocks(text: string, attachments: readonly PromptAttachment[] = []): BuiltPrompt {
	const blocks: PromptBlock[] = [{ type: 'text', text }];
	const degraded: { name: string; reason: 'too-large' | 'unreadable' }[] = [];
	const seen = new Set<string>();
	let budget = MAX_EMBEDDED_BYTES_TOTAL;

	for (const attachment of attachments) {
		// A file attached twice — once by the author, once because it is also
		// the active editor — must not be paid for twice.
		const key = attachment.range
			? `${attachment.uri}#${attachment.range.startLine}-${attachment.range.endLine}`
			: attachment.uri;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);

		if (attachment.text === undefined) {
			blocks.push({ type: 'resource_link', uri: attachment.uri, name: attachment.name });
			degraded.push({ name: attachment.name, reason: 'unreadable' });
			continue;
		}

		const size = byteLength(attachment.text);
		if (size > MAX_EMBEDDED_BYTES_PER_FILE || size > budget) {
			blocks.push({ type: 'resource_link', uri: attachment.uri, name: attachment.name });
			degraded.push({ name: attachment.name, reason: 'too-large' });
			continue;
		}
		budget -= size;
		blocks.push({
			type: 'resource',
			resource: {
				uri: attachment.range
					// A selection and its whole file are different attachments and
					// must not collapse onto one uri, or attaching both silently
					// keeps whichever arrived last.
					? `${attachment.uri}#L${attachment.range.startLine}-L${attachment.range.endLine}`
					: attachment.uri,
				mimeType: attachment.mimeType,
				text: attachment.text,
			},
		});
	}

	return { blocks, degraded };
}
