/*---------------------------------------------------------------------------------------------
 *  VS Novel — facts, on two axes.
 *--------------------------------------------------------------------------------------------*/

/**
 * A recorded state of the world, positioned twice.
 *
 * Every fact carries **where it was told** ({@link Fact.narrativeOrder}) and
 * **when it happened** ({@link Fact.storyTime}), and the two disagreeing is not
 * an error — it is a flashback. That distinction is the whole reason this type
 * has two axes instead of one, and getting it wrong produces the single most
 * damaging class of false positive a consistency checker can have: telling an
 * author that the chapter they deliberately set fifteen years earlier
 * contradicts the one before it.
 *
 * The rule that follows, and that the rest of the package obeys: **anything
 * about causality is decided on story time; anything about reading order is
 * decided on narrative order.** A character cannot act after they die in *story
 * time*; they can perfectly well appear in a later *chapter*.
 */

/**
 * A comparable moment inside the story.
 *
 * `day` is a number rather than a date because invented calendars are the norm
 * — 青云历 4102 has no month, and forcing it into a Date would either lose the
 * era or invent a mapping the author never agreed to. Comparison across eras is
 * refused rather than guessed; see {@link compareStoryTime}.
 */
export interface StoryTime {
	/** Calendar the day is counted in. Omitted when the work has only one. */
	readonly era?: string;
	/** Days elapsed within the era. Higher is later. */
	readonly day: number;
}

/**
 * Where a fact came from.
 *
 * Deliberately not a character offset. An author edits the manuscript every day,
 * and an offset is invalidated by the first insertion above it — every fact in
 * the book would silently point a few characters to the left, and the anchors
 * would rot without anything reporting it.
 *
 * Instead: the snippet itself, plus a hash of it. The snippet relocates the fact
 * after edits; the hash says whether the sentence it was drawn from still reads
 * the way it did when the fact was recorded. `line` is a hint for the fast path
 * only, and is never trusted.
 */
export interface Anchor {
	/** Workspace-relative path. */
	readonly file: string;
	/** The exact text the fact was drawn from. */
	readonly snippet: string;
	/** Fingerprint of {@link snippet}, so a rewrite is detectable. */
	readonly snippetHash: string;
	/** Last known line. A hint; {@link resolveAnchor} verifies before believing it. */
	readonly line?: number;
}

/**
 * One assertion about one subject.
 *
 * `dimension` and `value` are open strings rather than a closed union because
 * the dimensions a work needs are the author's to choose — 生死 and 在场位置 are
 * universal, but 灵力等级 or 契约归属 belong to one book. The consistency rules
 * that care about a dimension declare it themselves; see the life FSM.
 */
export interface Fact {
	readonly id: string;
	/** Position in reading order. Chapter × 1000 + offset within, by convention. */
	readonly narrativeOrder: number;
	/** When this happened in the story. Absent means "unplaced in time". */
	readonly storyTime?: StoryTime;
	readonly anchor?: Anchor;
	/** Character or item id the assertion is about. */
	readonly subject: string;
	/** e.g. 'life', 'location', 'possession'. */
	readonly dimension: string;
	/** The asserted value, e.g. 'dead'. */
	readonly value: string;
}

/**
 * Orders two story times.
 *
 * Returns undefined when the two are not comparable — different eras with no
 * declared ordering between them, or a fact with no time at all. Undefined is a
 * real answer here and callers must handle it: a rule that treats "I don't know"
 * as "not later" will silently stop checking, and one that treats it as "later"
 * will invent contradictions. Both failures are worse than declining.
 */
export function compareStoryTime(a: StoryTime | undefined, b: StoryTime | undefined, eraOrder?: readonly string[]): number | undefined {
	if (!a || !b) {
		return undefined;
	}
	const eraA = a.era ?? '';
	const eraB = b.era ?? '';
	if (eraA !== eraB) {
		if (!eraOrder) {
			return undefined;
		}
		const indexA = eraOrder.indexOf(eraA);
		const indexB = eraOrder.indexOf(eraB);
		if (indexA === -1 || indexB === -1) {
			return undefined;
		}
		return Math.sign(indexA - indexB);
	}
	return Math.sign(a.day - b.day);
}

/**
 * Whether `later` is told after `earlier` but set before it — a flashback.
 *
 * The check every temporal rule has to run before reporting a contradiction.
 */
export function isFlashback(earlier: Fact, later: Fact, eraOrder?: readonly string[]): boolean {
	if (later.narrativeOrder <= earlier.narrativeOrder) {
		return false;
	}
	const order = compareStoryTime(later.storyTime, earlier.storyTime, eraOrder);
	return order !== undefined && order < 0;
}

/**
 * Sorts facts into story order.
 *
 * Facts with no story time keep their narrative position relative to each other
 * and sort after everything that is placed — an unplaced fact cannot be shown to
 * precede anything, so putting it last is the reading that asserts least.
 */
export function byStoryTime(facts: readonly Fact[], eraOrder?: readonly string[]): Fact[] {
	return facts.slice().sort((a, b) => {
		const order = compareStoryTime(a.storyTime, b.storyTime, eraOrder);
		if (order !== undefined && order !== 0) {
			return order;
		}
		if (!a.storyTime !== !b.storyTime) {
			return a.storyTime ? -1 : 1;
		}
		return a.narrativeOrder - b.narrativeOrder;
	});
}

/**
 * Fingerprints an anchored snippet.
 *
 * FNV-1a over the code units: small, dependency-free, and stable across
 * platforms and releases — which matters more than collision resistance,
 * because a fact file written today is compared against a manuscript edited for
 * years. A cryptographic hash would be a stronger fingerprint and a weaker
 * guarantee of that stability, since it would tie the format to whichever
 * crypto surface happens to be available.
 *
 * Whitespace is normalised first: reflowing a paragraph is not a rewrite of the
 * sentence, and reporting it as one would make every reformat look like drift.
 */
export function hashSnippet(snippet: string): string {
	const normalized = snippet.replace(/\s+/g, ' ').trim();
	let hash = 0x811c9dc5;
	for (let i = 0; i < normalized.length; i++) {
		hash ^= normalized.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export type AnchorStatus =
	/** Found, and the text still reads as it did. */
	| 'exact'
	/** Found elsewhere in the file — the author moved or inserted above it. */
	| 'moved'
	/** Not found. The sentence this fact was drawn from is gone or rewritten. */
	| 'lost';

export interface ResolvedAnchor {
	readonly status: AnchorStatus;
	/** Zero-based line, when found. */
	readonly line?: number;
	/** Offset of the snippet, when found. */
	readonly offset?: number;
}

/**
 * Re-locates an anchor in the current text.
 *
 * Tries the remembered line first, because in the overwhelmingly common case
 * nothing above it changed and that check is a single comparison. Falls back to
 * a search, which is what makes the anchor survive the author's ordinary day.
 *
 * A `lost` result is not an error to be swallowed. It means the sentence a fact
 * was drawn from no longer exists, and the fact may now be asserting something
 * the manuscript does not say — exactly the thing worth telling the author.
 */
export function resolveAnchor(anchor: Anchor, text: string): ResolvedAnchor {
	const lines = text.split('\n');

	if (anchor.line !== undefined && anchor.line < lines.length) {
		const at = lines[anchor.line].indexOf(anchor.snippet);
		if (at !== -1) {
			return { status: 'exact', line: anchor.line, offset: offsetOfLine(lines, anchor.line) + at };
		}
	}

	const offset = text.indexOf(anchor.snippet);
	if (offset === -1) {
		return { status: 'lost' };
	}
	return { status: 'moved', line: lineOfOffset(text, offset), offset };
}

/** Whether the anchored text still hashes to what was recorded. */
export function anchorIsIntact(anchor: Anchor): boolean {
	return hashSnippet(anchor.snippet) === anchor.snippetHash;
}

function offsetOfLine(lines: readonly string[], line: number): number {
	let offset = 0;
	for (let i = 0; i < line; i++) {
		offset += lines[i].length + 1;
	}
	return offset;
}

function lineOfOffset(text: string, offset: number): number {
	let line = 0;
	for (let i = 0; i < offset; i++) {
		if (text.charCodeAt(i) === 10) {
			line++;
		}
	}
	return line;
}
