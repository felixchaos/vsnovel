/*---------------------------------------------------------------------------------------------
 *  VS Novel — ranked search, and what it refuses to show.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { chapterOf, searchManuscript, SearchableFile } from '../manuscriptSearch';

/** A book where one common word appears in four widely separated chapters. */
const BANQUET: SearchableFile[] = [
	{ path: '第五十二章.md', text: '宴会开始了。城主举杯，众人起身。她坐在最末的位置上，没有人看她。' },
	{ path: '第一百五十二章.md', text: '又一场宴会。这次她坐在主位，杯中是南境送来的酒。' },
	{ path: '第四百章.md', text: '宴会散去之后，长廊里只剩下灯。' },
	{ path: '第一千三百一十章.md', text: '最后一场宴会。所有人都知道结局是什么，只有她还在笑。' },
];

describe('chapter numbers from file names', () => {

	it('reads the forms a manuscript is actually named in', () => {
		expect(chapterOf('第三章.md')).toBe(3);
		expect(chapterOf('第十二章 夜奔.md')).toBe(12);
		expect(chapterOf('第一百五十二章.md')).toBe(152);
		expect(chapterOf('第一千三百一十章.md')).toBe(1310);
		expect(chapterOf('ch12-flight.txt')).toBe(12);
		expect(chapterOf('003 夜奔.md')).toBe(3);
		expect(chapterOf('第５章.md')).toBe(5);
	});

	// A wrong number is worse than none: it reorders results and, with the gate
	// on, withholds or reveals the wrong passages.
	it('returns nothing rather than a guess', () => {
		expect(chapterOf('设定集.md')).toBeUndefined();
		expect(chapterOf('notes.txt')).toBeUndefined();
	});
});

describe('searching', () => {

	it('finds the passages that contain the query', () => {
		const { results } = searchManuscript(BANQUET, '宴会');
		expect(results.length).toBeGreaterThan(0);
		expect(results.every(r => r.text.includes('宴会'))).toBe(true);
	});

	it('names the file and chapter each passage came from', () => {
		const { results } = searchManuscript(BANQUET, '南境的酒');
		expect(results[0].path).toBe('第一百五十二章.md');
		expect(results[0].chapter).toBe(152);
	});

	it('finds nothing for a term the book does not use', () => {
		expect(searchManuscript(BANQUET, '飞船').results).toEqual([]);
	});

	// The reason ripgrep is not enough. Exact match gives every hit; what an
	// author needs from a book this size is the few that matter.
	it('limits the results rather than returning every hit', () => {
		const { results } = searchManuscript(BANQUET, '宴会', { limit: 2 });
		expect(results).toHaveLength(2);
	});
});

describe('the reveal gate', () => {

	// The thing a coding search tool has no reason to do. A passage from the
	// last chapter, shown while chapter 5 is being drafted, is how a draft comes
	// to know its own ending.
	it('withholds later chapters when a position is given', () => {
		const { results, withheld } = searchManuscript(BANQUET, '宴会', { currentChapter: 60 });
		expect(results.every(r => (r.chapter ?? 0) <= 60)).toBe(true);
		expect(withheld).toBeGreaterThan(0);
	});

	// Silence here is the failure mode: a search that quietly returns less is
	// indistinguishable from a search that found less.
	it('says how much it withheld', () => {
		const early = searchManuscript(BANQUET, '宴会', { currentChapter: 60 });
		const all = searchManuscript(BANQUET, '宴会');
		expect(early.withheld).toBe(all.results.length - early.results.length);
	});

	// An author asking where they mentioned something knows their own book.
	// The restriction belongs to drafting, not to searching.
	it('does not restrict a search with no stated position', () => {
		const { results, withheld } = searchManuscript(BANQUET, '宴会');
		expect(withheld).toBe(0);
		expect(results.some(r => r.chapter === 1310)).toBe(true);
	});

	// Gating runs before the limit. That ordering is deliberate but this test does
	// not prove it, and saying so is more useful than a green tick that means
	// nothing: I could not build a case that distinguishes the two orders.
	//
	// The reason is the scorer. Weighting is log(N/df), so a term that appears in
	// every passage has df = N and scores zero — everything ties, and ties break
	// toward the earlier chapter. A term concentrated in the late chapters scores
	// well there but then the early chapters do not match at all. Either way the
	// two orders agree. Gating first is still the correct order, because nothing
	// about the scorer guarantees that agreement.
	//
	// What is asserted here is the contract a caller can rely on: the limit is
	// filled from what survived, and what did not survive is counted.
	it('fills the limit from survivors and counts the rest', () => {
		const loudEnding: SearchableFile[] = [
			{ path: '第一章.md', text: '宴会开始了，她坐在末位，没有人看她。' },
			{ path: '第二章.md', text: '长廊只剩下灯，宴会散了。' },
			{ path: '第三章.md', text: '她仍旧沉默，宴会又起。' },
			...Array.from({ length: 12 }, (_, i) => ({
				path: `第${900 + i}章.md`,
				text: '最后一场宴会上，结局已经写好了。',
			})),
		];
		const { results, withheld } = searchManuscript(loudEnding, '宴会', { currentChapter: 10, limit: 3 });
		expect(results).toHaveLength(3);
		expect(results.every(r => (r.chapter ?? 0) <= 10)).toBe(true);
		expect(withheld).toBe(12);
	});
});
