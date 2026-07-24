/*---------------------------------------------------------------------------------------------
 *  VS Novel — chunking prose.
 *--------------------------------------------------------------------------------------------*/

/**
 * Splits a chapter into retrievable pieces.
 *
 * Chunking prose is not chunking code. A function can be cut at a brace and both
 * halves remain readable; a paragraph cut mid-sentence produces a fragment that
 * retrieves well and reads as nonsense when it lands in a prompt — and the model
 * will happily continue the broken sentence.
 *
 * So the boundaries are the ones the text already has, in this order:
 * paragraph, then sentence. A chunk overshoots its target size rather than break
 * a sentence, and only falls back to a hard cut for input that has neither — a
 * wall of text with no punctuation, which does happen in imported drafts.
 *
 * Sentence terminators are full-width first. The manuscript is Chinese and
 * Japanese before it is English, and a splitter that only knows `.` produces one
 * chunk per chapter for the majority of the corpus — a bug that looks like
 * "retrieval returns whole chapters" rather than like a tokenizer problem.
 */

export interface Chunk {
	readonly id: string;
	readonly text: string;
	/** Offset of the chunk in the source text. */
	readonly start: number;
	readonly end: number;
	/** Chapter this came from, when known. Drives the reveal gate and ranking. */
	readonly chapter?: number;
}

export interface ChunkOptions {
	/** Characters aimed for. A chunk may exceed this to finish a sentence. */
	readonly targetSize?: number;
	/**
	 * How much of the previous chunk to repeat at the start of the next.
	 *
	 * Overlap exists so a fact stated across a paragraph break is retrievable
	 * from either side. Without it the answer to "why did he go north" can sit
	 * exactly on a boundary and be found by neither chunk.
	 */
	readonly overlap?: number;
	readonly chapter?: number;
	/** Prefix for generated ids. Usually the file path. */
	readonly idPrefix?: string;
}

const DEFAULT_TARGET = 600;
const DEFAULT_OVERLAP = 80;

/** Sentence ends, full-width first — this corpus is CJK before it is Latin. */
const SENTENCE_END = /[。！？…‥」』】）]|\.\s|!\s|\?\s/;

/**
 * Splits text into chunks.
 *
 * Frontmatter is skipped: it is metadata about the chapter, not prose from it,
 * and indexing it makes every chapter match a query for its own field names.
 */
export function chunk(text: string, options: ChunkOptions = {}): Chunk[] {
	const target = options.targetSize ?? DEFAULT_TARGET;
	const overlap = Math.min(options.overlap ?? DEFAULT_OVERLAP, Math.floor(target / 2));
	const prefix = options.idPrefix ?? 'chunk';

	const bodyStart = frontmatterEnd(text);
	const body = text.slice(bodyStart);
	if (!body.trim()) {
		return [];
	}

	const chunks: Chunk[] = [];
	let cursor = 0;

	while (cursor < body.length) {
		// Skip leading whitespace so a chunk never starts on a blank line.
		while (cursor < body.length && /\s/.test(body[cursor])) {
			cursor++;
		}
		if (cursor >= body.length) {
			break;
		}

		const end = boundaryAfter(body, cursor, target);
		const slice = body.slice(cursor, end).trim();
		if (slice) {
			const start = bodyStart + cursor + body.slice(cursor, end).indexOf(slice[0]);
			chunks.push({
				id: `${prefix}#${chunks.length}`,
				text: slice,
				start,
				end: start + slice.length,
				chapter: options.chapter,
			});
		}

		if (end >= body.length) {
			break;
		}
		// Step back by the overlap, but never far enough to fail to advance —
		// a chunk that starts where the last one did loops forever.
		cursor = Math.max(cursor + 1, end - overlap);
	}

	return chunks;
}

/**
 * Finds where to cut, preferring a boundary the text already has.
 *
 * Paragraph first, then sentence, then a hard cut. The hard cut is reached only
 * by text with no punctuation and no blank lines for a whole target's width,
 * which is a real shape in imported drafts and must not hang the indexer.
 */
function boundaryAfter(text: string, from: number, target: number): number {
	const ideal = from + target;
	if (ideal >= text.length) {
		return text.length;
	}

	// A paragraph break at or before the target, but not so far back that the
	// chunk becomes tiny — half the target is the floor.
	const floor = from + Math.floor(target / 2);
	const paragraph = text.lastIndexOf('\n\n', ideal);
	if (paragraph >= floor) {
		return paragraph;
	}

	// Otherwise the last sentence end at or before the target.
	for (let i = ideal; i > floor; i--) {
		if (SENTENCE_END.test(text[i])) {
			return i + 1;
		}
	}

	// Or the next sentence end after it — overshooting is better than cutting a
	// sentence in half, as long as it does not run away.
	for (let i = ideal; i < Math.min(text.length, ideal + target); i++) {
		if (SENTENCE_END.test(text[i])) {
			return i + 1;
		}
	}

	return ideal;
}

/** Offset just past the frontmatter block, or 0. */
function frontmatterEnd(text: string): number {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
	return match ? match[0].length : 0;
}
