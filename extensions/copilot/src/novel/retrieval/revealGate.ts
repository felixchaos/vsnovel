/*---------------------------------------------------------------------------------------------
 *  VS Novel — the spoiler gate.
 *--------------------------------------------------------------------------------------------*/

/**
 * The single exit every retrieved passage passes through.
 *
 * The failure this prevents is specific and severe: the author is writing
 * chapter 30, asks about a character, and the assistant answers using a passage
 * from chapter 200 that reveals who that character turns out to be. Nothing in
 * the manuscript is wrong; the retrieval simply had no notion that some of it
 * has not happened yet from the reader's position. For a work in progress the
 * consequence is worse than a bad answer — the tool has told the author's own
 * story back to them out of order, and for a translator it leaks the ending into
 * an early chapter's rendering.
 *
 * Two commitments make that impossible rather than unlikely:
 *
 *  - **Sole exit.** Every recall route — lexical, vector, worldbook, facts —
 *    ends here. A second path that skips the gate is the only way a spoiler can
 *    reach the prompt, so there is exactly one.
 *  - **Fail closed.** Anything whose position is unknown is withheld, not
 *    admitted. The predecessor's own note on this was "NULL tightens": a
 *    passage with no recorded reveal point might be from the last chapter, and
 *    admitting it on the grounds that nobody said otherwise is how a leak
 *    happens. The cost of the opposite mistake is a passage the author has to
 *    look up themselves; the cost of this one is their ending, spoiled by their
 *    own tool.
 */

export interface Revealable {
	/**
	 * Earliest chapter from which this may be shown.
	 *
	 * Undefined means unknown, which is treated as "not yet" — see the class
	 * comment.
	 */
	readonly firstRevealed?: number;
}

export interface GateOptions {
	/**
	 * The chapter the author is working in. Anything first revealed after this
	 * is withheld.
	 *
	 * Undefined means "no position", which withholds everything that carries a
	 * reveal point at all — the honest reading when we do not know where the
	 * author is standing.
	 */
	readonly currentChapter?: number;
	/**
	 * Let unplaced material through.
	 *
	 * For the one legitimate case: an author explicitly asking to see the whole
	 * manuscript, e.g. while revising the ending. Never a default, and never
	 * inferred from the query.
	 */
	readonly allowUnplaced?: boolean;
}

export interface GateResult<T> {
	readonly allowed: T[];
	/** What was withheld, and why. Surfaced so the author can see the gate working. */
	readonly withheld: { readonly item: T; readonly reason: 'future' | 'unplaced' }[];
}

/**
 * Filters items to what the author may see from where they are standing.
 *
 * Returns the withheld set alongside rather than dropping it silently: a gate
 * that quietly removes results is indistinguishable from a retrieval bug, and
 * an author who cannot tell the difference will stop trusting the answers.
 */
export function revealGate<T extends Revealable>(items: readonly T[], options: GateOptions = {}): GateResult<T> {
	const allowed: T[] = [];
	const withheld: { item: T; reason: 'future' | 'unplaced' }[] = [];

	for (const item of items) {
		if (item.firstRevealed === undefined) {
			if (options.allowUnplaced) {
				allowed.push(item);
			} else {
				withheld.push({ item, reason: 'unplaced' });
			}
			continue;
		}
		if (options.currentChapter === undefined || item.firstRevealed > options.currentChapter) {
			withheld.push({ item, reason: 'future' });
			continue;
		}
		allowed.push(item);
	}

	return { allowed, withheld };
}

/** The common case: just the passages that may be shown. */
export function allowed<T extends Revealable>(items: readonly T[], options: GateOptions = {}): T[] {
	return revealGate(items, options).allowed;
}
