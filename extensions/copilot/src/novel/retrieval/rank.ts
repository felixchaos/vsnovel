/*---------------------------------------------------------------------------------------------
 *  VS Novel — two-stage ranking.
 *--------------------------------------------------------------------------------------------*/

/**
 * Orders retrieved passages for a prompt.
 *
 * Two rules, both cheap, both recorded here because they were learned from
 * failures rather than reasoned out in advance.
 *
 * **Two stages: select by relevance, present in story order.** The inner stage
 * keeps the top K by score. The outer stage then sorts what survived by chapter,
 * ascending. Without the second stage a passage from chapter 800 arrives above
 * one from chapter 3, and a model reading the prompt top-down takes the order as
 * chronology — it answers as though the late event has already happened. The
 * relevance ranking still decides *what* is included; it just stops deciding
 * what looks like history.
 *
 * **Ties break toward the earlier chapter.** This one comes from a real
 * incident. A common word — 宴会 — appeared in chapters 52, 152, … 1310, every
 * occurrence scoring identically. A descending sort picked chapter 1310, the
 * finale, and anchored an early-chapter reader's context to the ending. When
 * scores are equal there is no evidence for the later passage, and the later
 * passage is the one that can spoil.
 */

export interface Rankable {
	readonly chunkId: string;
	readonly score: number;
	/** Chapter this passage belongs to. Undefined sorts last; see below. */
	readonly chapter?: number;
}

export interface TwoStageOptions {
	/** How many survive the relevance stage. */
	readonly limit?: number;
	/**
	 * Drop anything at or beyond this chapter before ranking.
	 *
	 * A blunt second line behind the reveal gate. The gate is the real defence;
	 * this exists because a bound applied at ranking time is one more place a
	 * future passage has to get through, and both are cheap.
	 */
	readonly maxChapter?: number;
}

/**
 * Selects by relevance, then presents in story order.
 */
export function twoStageRank<T extends Rankable>(items: readonly T[], options: TwoStageOptions = {}): T[] {
	const bounded = options.maxChapter === undefined
		? items
		: items.filter(item => item.chapter === undefined || item.chapter <= options.maxChapter!);

	const selected = bounded
		.slice()
		.sort(byRelevanceThenEarliest)
		.slice(0, Math.max(0, options.limit ?? bounded.length));

	return selected.sort(byChapterThenRelevance);
}

/**
 * Relevance first, earliest chapter as the tie-break.
 *
 * The tie-break is the anti-spoiler rule, and it belongs in the *selection*
 * stage rather than only in presentation: when a top-K cut has to choose between
 * two equally scored passages, taking the later one puts the ending into the
 * prompt and leaves the early passage out entirely. Presentation order cannot
 * undo that.
 */
export function byRelevanceThenEarliest(a: Rankable, b: Rankable): number {
	if (a.score !== b.score) {
		return b.score - a.score;
	}
	const chapterA = a.chapter ?? Number.POSITIVE_INFINITY;
	const chapterB = b.chapter ?? Number.POSITIVE_INFINITY;
	if (chapterA !== chapterB) {
		return chapterA - chapterB;
	}
	// Fully determined, so the same query yields the same prompt every time.
	return a.chunkId.localeCompare(b.chunkId);
}

/**
 * Story order for presentation.
 *
 * A passage with no chapter sorts last rather than first: it cannot be shown to
 * precede anything, and putting it at the top would be the same misreading the
 * two-stage rule exists to prevent, in a quieter form.
 */
export function byChapterThenRelevance(a: Rankable, b: Rankable): number {
	const chapterA = a.chapter ?? Number.POSITIVE_INFINITY;
	const chapterB = b.chapter ?? Number.POSITIVE_INFINITY;
	if (chapterA !== chapterB) {
		return chapterA - chapterB;
	}
	if (a.score !== b.score) {
		return b.score - a.score;
	}
	return a.chunkId.localeCompare(b.chunkId);
}
