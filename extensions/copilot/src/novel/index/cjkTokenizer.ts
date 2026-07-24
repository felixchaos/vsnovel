/*---------------------------------------------------------------------------------------------
 *  VS Novel — CJK tokenizer for lexical recall.
 *--------------------------------------------------------------------------------------------*/

/**
 * Search tokens for Chinese, Japanese and English prose, without a dictionary.
 *
 * This exists because the genre is built on invented proper nouns. An author
 * searching for 玄冥子 wants the passages containing 玄冥子, and a vector search
 * cannot give them that: an embedding of a name it has never seen lands next to
 * its semantic neighbours — other elders, other sects — and the exact passage
 * ranks below them. Character-bigram matching has no such failure mode, because
 * it never generalises in the first place.
 *
 * It is deliberately dictionary-free. Any segmenter good enough for prose is
 * also a segmenter that has never heard of 玄冥子 and will split it wrongly and
 * silently. Sliding bigrams cannot mis-segment because they do not segment.
 *
 * The cost is precision: 玄冥 also matches 玄冥宗. That is the right trade for a
 * recall stage whose output is re-ranked afterwards, and it is why these tokens
 * are a retrieval signal rather than an answer.
 */

/**
 * Han characters, plus the extension A block. Deliberately not the rarer
 * supplementary planes: they are surrogate pairs in JavaScript, and a bigram cut
 * on code units would split one character in half.
 */
const HAN = '\\u3400-\\u4dbf\\u4e00-\\u9fff';

/**
 * Hiragana and katakana, including the prolonged sound mark ー and the iteration
 * marks. Japanese needs them in the same class as Han: a name like ミサキ is
 * pure katakana, and 御剣 is Han, and both must tokenize.
 */
const KANA = '\\u3040-\\u30ff\\u31f0-\\u31ff';

/** One run of CJK text — the unit bigrams are cut from. */
const CJK_RUN = new RegExp(`[${HAN}${KANA}]+`, 'g');

/**
 * One Latin/numeric word. Apostrophes are kept inside a word so "O'Brien" stays
 * one token; hyphens are not, so "well-known" yields two, which is what a reader
 * searching for either half expects.
 */
const LATIN_RUN = /[a-z0-9À-ɏ]+(?:'[a-z]+)*/gi;

/**
 * How many tokens one query contributes.
 *
 * A long paragraph pasted into a search box would otherwise produce hundreds of
 * bigrams, and a query that matches everything ranks nothing. Sixteen is enough
 * for a sentence-length query and short enough that the longest, most selective
 * tokens survive the cut — see the sort in {@link tokenize}.
 */
export const MAX_QUERY_TOKENS = 16;

export interface TokenizeOptions {
	/**
	 * Cap the result, keeping the most selective tokens. Set for a query; leave
	 * unset when indexing a document, where every token must be stored or the
	 * document becomes unfindable by the tokens that were dropped.
	 */
	readonly limit?: number;
}

/**
 * Splits text into search tokens.
 *
 * CJK runs become every overlapping 2-character bigram; Latin runs become
 * case-folded words. A one-character CJK run is kept as itself — a single 字 is
 * a legitimate search, and dropping it would silently return nothing.
 *
 * Order is by length descending, so a `limit` keeps the tokens that discriminate
 * most. Within a length, first-seen order is preserved so the result is stable
 * for the same input — an unstable token list would make cached queries miss.
 */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
	if (!text) {
		return [];
	}

	// Insertion-ordered, so the length sort below is stable on ties.
	const seen = new Set<string>();

	for (const run of text.match(CJK_RUN) ?? []) {
		if (run.length === 1) {
			seen.add(run);
			continue;
		}
		for (let i = 0; i + 2 <= run.length; i++) {
			seen.add(run.slice(i, i + 2));
		}
	}

	for (const run of text.match(LATIN_RUN) ?? []) {
		// Case-folded, not lowercased: ﬁ and İ fold in ways toLowerCase alone
		// gets wrong, and a name is exactly where that shows up.
		const folded = run.toLocaleLowerCase();
		if (folded.length >= 2) {
			seen.add(folded);
		}
	}

	const tokens = Array.from(seen);
	if (options.limit === undefined) {
		return tokens;
	}
	// Longer tokens are rarer, so they survive truncation. Sorting a copy of an
	// insertion-ordered array keeps equal-length tokens in first-seen order.
	return tokens.sort((a, b) => b.length - a.length).slice(0, Math.max(0, options.limit));
}

/**
 * Tokenizes a query — the same function, capped.
 *
 * Separate from {@link tokenize} only so the two call sites read differently:
 * forgetting the cap on the query side is a silent relevance bug, not an error.
 */
export function tokenizeQuery(text: string, limit: number = MAX_QUERY_TOKENS): string[] {
	return tokenize(text, { limit });
}

/**
 * True when the text contains any CJK character.
 *
 * The caller is usually deciding whether a code-oriented default applies — word
 * boundaries, whitespace segmentation — none of which hold for CJK prose.
 */
export function hasCJK(text: string): boolean {
	return new RegExp(`[${HAN}${KANA}]`).test(text);
}
