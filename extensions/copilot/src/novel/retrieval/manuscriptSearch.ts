/*---------------------------------------------------------------------------------------------
 *  VS Novel — ranked search over a manuscript.
 *--------------------------------------------------------------------------------------------*/

/**
 * What `grep` cannot do.
 *
 * ripgrep is exact and fast and works on Chinese without any help, which is why
 * it stays the backbone. What it does not have is an order: over 4.85 million
 * characters, "宴会" matches in chapters 52, 152, 400 and 1310 and they arrive
 * in whatever order the walk found them. The agent then reads the first few.
 *
 * Upstream's ranked search is `copilot_searchCodebase`, and it is gated in this
 * product because its tokenizer is built for code identifiers and extracts zero
 * tokens from Chinese. This is the replacement: the same job, over prose.
 *
 * The reveal gate is the part with no counterpart in a coding tool. A codebase
 * has no future; a manuscript does, and a passage from chapter 800 shown while
 * the author is drafting chapter 3 is how a draft acquires knowledge its
 * narrator cannot have.
 */

import { chunk, Chunk } from '../index/chunker';
import { InvertedIndex } from '../index/invertedIndex';
import { revealGate } from './revealGate';
import { twoStageRank } from './rank';

export interface SearchableFile {
	/** Workspace-relative path, which is also what a result has to name. */
	readonly path: string;
	readonly text: string;
	/**
	 * Which chapter this file is. Drives both ordering and the reveal gate.
	 *
	 * Undefined is honest rather than defaulted — see {@link chapterOf}. A file
	 * whose position is unknown still participates in search; it is only the
	 * gate that treats unknown as "withhold", and only when the caller stated a
	 * position to withhold against.
	 */
	readonly chapter?: number;
}

export interface SearchOptions {
	/**
	 * The chapter being written.
	 *
	 * When given, nothing from a later chapter is returned — the whole point of
	 * the gate. When omitted, the search is unrestricted, which is the right
	 * answer for an author asking where they mentioned something: they know
	 * their own book, and there is nothing to spoil for them. The restriction
	 * exists to keep *the prose* from knowing its own future, so it belongs to
	 * the act of drafting, not to searching.
	 */
	readonly currentChapter?: number;
	readonly limit?: number;
}

export interface SearchResult {
	readonly path: string;
	readonly chapter?: number;
	readonly text: string;
	readonly score: number;
	/** Query tokens this passage actually contained, to explain the hit. */
	readonly matched: readonly string[];
}

export interface SearchOutcome {
	readonly results: readonly SearchResult[];
	/**
	 * How many passages the gate withheld.
	 *
	 * Reported rather than dropped in silence. A search that quietly returns
	 * less is indistinguishable from a search that found less, and the two call
	 * for opposite responses from whoever asked.
	 */
	readonly withheld: number;
}

const DEFAULT_LIMIT = 12;

/**
 * Derives a chapter number from a file name.
 *
 * Handles what a manuscript is actually named — `第三章.md`, `003 夜奔.md`,
 * `ch12-flight.txt` — and returns undefined rather than a guess for anything
 * else. A wrong chapter number is worse than none: it reorders results and, if
 * the gate is on, withholds or reveals the wrong passages.
 */
export function chapterOf(path: string): number | undefined {
	const name = path.split('/').pop() ?? path;
	const cjk = /第\s*([0-9０-９一二三四五六七八九十百千]+)\s*[章回话話]/.exec(name);
	if (cjk) {
		const parsed = parseChineseNumber(cjk[1]);
		if (parsed !== undefined) {
			return parsed;
		}
	}
	const latin = /(?:^|[^0-9])(?:ch(?:apter)?[-_ ]?)?([0-9]{1,4})(?:[^0-9]|$)/i.exec(name);
	return latin ? Number(latin[1]) : undefined;
}

/** Arabic, full-width, or Chinese numerals up to 千. Undefined if unclear. */
function parseChineseNumber(raw: string): number | undefined {
	const normalized = raw.replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xFF10));
	if (/^[0-9]+$/.test(normalized)) {
		return Number(normalized);
	}

	const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
	const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
	let total = 0;
	let current = 0;
	for (const ch of normalized) {
		if (ch in digits) {
			current = digits[ch];
		} else if (ch in units) {
			// 十 with nothing before it is ten, not zero — 十二 is 12.
			total += (current || 1) * units[ch];
			current = 0;
		} else {
			return undefined;
		}
	}
	return total + current || undefined;
}

/**
 * Searches the given files.
 *
 * Builds the index per call. At this scale that is milliseconds and it removes
 * the failure mode that matters most for an agent checking its own work:
 * a cached index does not contain the chapter written one turn ago, and
 * searching a stale index reports success.
 */
export function searchManuscript(
	files: readonly SearchableFile[],
	query: string,
	options: SearchOptions = {},
): SearchOutcome {
	const index = new InvertedIndex();
	const chunks = new Map<string, { chunk: Chunk; path: string }>();

	for (const file of files) {
		const chapter = file.chapter ?? chapterOf(file.path);
		for (const piece of chunk(file.text, { chapter, idPrefix: file.path })) {
			index.add({ id: piece.id, text: piece.text });
			chunks.set(piece.id, { chunk: piece, path: file.path });
		}
	}

	const limit = options.limit ?? DEFAULT_LIMIT;
	// Over-fetch before gating, so withholding a passage promotes the next one
	// rather than leaving a hole in the results.
	const hits = index.search(query, Math.max(limit * 4, 50));

	const candidates = hits.flatMap(hit => {
		const found = chunks.get(hit.chunkId);
		if (!found) {
			return [];
		}
		return [{
			chunkId: hit.chunkId,
			score: hit.score,
			matched: hit.matched,
			chapter: found.chunk.chapter,
			path: found.path,
			text: found.chunk.text,
			// A passage is first knowable at the chapter it appears in. That
			// identity is what lets the gate work without a separate record.
			firstRevealed: found.chunk.chapter,
		}];
	});

	// Only when a position was stated — see SearchOptions.currentChapter.
	const gated = options.currentChapter === undefined
		? { allowed: candidates, withheld: [] as typeof candidates }
		: revealGate(candidates, { currentChapter: options.currentChapter });

	const ranked = twoStageRank(gated.allowed, { limit });

	return {
		results: ranked.map(item => ({
			path: item.path,
			chapter: item.chapter,
			text: item.text,
			score: item.score,
			matched: item.matched,
		})),
		withheld: gated.withheld.length,
	};
}
