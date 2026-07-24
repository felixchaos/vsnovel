/*---------------------------------------------------------------------------------------------
 *  VS Novel — CJK tokenizer tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { hasCJK, MAX_QUERY_TOKENS, tokenize, tokenizeQuery } from '../cjkTokenizer';

describe('tokenize', () => {
	it('cuts a Han run into overlapping bigrams', () => {
		expect(tokenize('玄冥子')).toEqual(['玄冥', '冥子']);
	});

	// The reason this tokenizer exists: an invented name must be findable by an
	// exact match, which a dictionary segmenter cannot promise for a word it has
	// never seen.
	it('recalls an invented proper noun from surrounding prose', () => {
		const chapter = '玄冥子站在山门前，身后是玄冥宗的弟子。';
		const query = tokenizeQuery('玄冥子');
		expect(query.every(t => tokenize(chapter).includes(t))).toBe(true);
	});

	it('keeps a lone CJK character rather than dropping it', () => {
		// A one-character run has no bigram; discarding it would make 剑 unsearchable.
		expect(tokenize('一剑，')).toEqual(['一剑']);
		expect(tokenize('剑')).toEqual(['剑']);
	});

	it('tokenizes katakana and han in the same run class', () => {
		expect(tokenize('ミサキ')).toEqual(['ミサ', 'サキ']);
		expect(tokenize('御剣')).toEqual(['御剣']);
	});

	it('splits on punctuation so bigrams never straddle a sentence break', () => {
		// 子。他 would be a bigram spanning the full stop — a token that matches
		// text the author never wrote.
		expect(tokenize('玄冥子。他走了')).not.toContain('子他');
	});

	it('case-folds Latin words and drops single letters', () => {
		expect(tokenize('The Mulelia A')).toEqual(['the', 'mulelia']);
	});

	it("keeps an apostrophe inside a word but splits a hyphen", () => {
		expect(tokenize("O'Brien well-known")).toEqual(["o'brien", 'well', 'known']);
	});

	it('deduplicates repeated bigrams', () => {
		expect(tokenize('玄冥玄冥')).toEqual(['玄冥', '冥玄']);
	});

	it('mixes scripts in one pass', () => {
		expect(tokenize('林轩 said hi')).toEqual(['林轩', 'said', 'hi']);
	});

	it('returns nothing for empty or symbol-only input', () => {
		expect(tokenize('')).toEqual([]);
		expect(tokenize('。、！ ——')).toEqual([]);
	});
});

describe('tokenizeQuery', () => {
	it('caps the token count so a pasted paragraph cannot match everything', () => {
		const paragraph = '风雪夜归人来到山门前叩响铜环等待良久无人应答只得转身离去';
		expect(tokenizeQuery(paragraph)).toHaveLength(MAX_QUERY_TOKENS);
	});

	// The cap must keep the selective tokens. A Latin word is longer than a CJK
	// bigram, so it has to survive a truncation that drops bigrams.
	it('keeps longer, rarer tokens when truncating', () => {
		const tokens = tokenizeQuery('林轩走过长街遇见故人相视无言各自离去 Mulelia', 3);
		expect(tokens[0]).toBe('mulelia');
		expect(tokens).toHaveLength(3);
	});

	it('is stable across calls, so a cached query cannot miss', () => {
		const text = '玄冥子与林轩 Mulelia';
		expect(tokenizeQuery(text)).toEqual(tokenizeQuery(text));
	});

	// Indexing must not truncate: a token dropped at index time makes the
	// document unfindable by that token forever, which a query-side cap does not.
	it('does not cap when indexing', () => {
		const paragraph = '风雪夜归人来到山门前叩响铜环等待良久无人应答只得转身离去';
		expect(tokenize(paragraph).length).toBeGreaterThan(MAX_QUERY_TOKENS);
	});
});

describe('hasCJK', () => {
	it('distinguishes prose that needs CJK handling from prose that does not', () => {
		expect(hasCJK('林轩')).toBe(true);
		expect(hasCJK('ミサキ')).toBe(true);
		expect(hasCJK('plain english')).toBe(false);
	});
});
