/*---------------------------------------------------------------------------------------------
 *  VS Novel — multi-pattern search tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { AhoCorasick } from '../ahoCorasick';

/** Matches as (pattern, start) pairs, which reads better in a failure message. */
function found(patterns: string[], text: string): [string, number][] {
	return AhoCorasick.build(patterns)
		.findAll(text)
		.map(m => [patterns[m.patternId], m.start] as [string, number]);
}

describe('AhoCorasick', () => {
	it('finds a single pattern', () => {
		expect(found(['李慕白'], '那日李慕白提剑而来')).toEqual([['李慕白', 2]]);
	});

	it('finds every occurrence of a repeated pattern', () => {
		expect(found(['林轩'], '林轩看着林轩的影子')).toEqual([['林轩', 0], ['林轩', 4]]);
	});

	it('finds all patterns in one pass', () => {
		expect(found(['李慕白', '张小凡'], '张小凡拜李慕白为师')).toEqual([['张小凡', 0], ['李慕白', 4]]);
	});

	// 李慕白 contains 慕白. The caller decides which wins; it can only decide if
	// the automaton reports both. Ties at the same end offset come out
	// longest-first, because the deeper state is visited before its fail chain.
	it('reports nested matches, longest not silently dropped', () => {
		expect(found(['李慕白', '慕白'], '李慕白')).toEqual([['李慕白', 0], ['慕白', 1]]);
	});

	it('reports overlapping matches', () => {
		expect(found(['aba', 'bab'], 'ababa')).toEqual([['aba', 0], ['bab', 1], ['aba', 2]]);
	});

	it('reports offsets usable as a range', () => {
		const text = '那日李慕白提剑';
		const [match] = AhoCorasick.build(['李慕白']).findAll(text);
		expect(text.slice(match.start, match.end)).toBe('李慕白');
	});

	it('handles a pattern that is a prefix of another', () => {
		expect(found(['玄冥', '玄冥子'], '玄冥子来了')).toEqual([['玄冥', 0], ['玄冥子', 0]]);
	});

	it('keeps pattern ids aligned when an empty pattern is present', () => {
		// An empty surface form is a data error the caller reports separately; it
		// must not shift the ids of everything after it.
		const patterns = ['', '林轩'];
		const ac = AhoCorasick.build(patterns);
		expect(ac.findAll('林轩').map(m => m.patternId)).toEqual([1]);
		expect(ac.size).toBe(2);
	});

	it('returns nothing for no patterns or no text', () => {
		expect(AhoCorasick.build([]).findAll('林轩')).toEqual([]);
		expect(found(['林轩'], '')).toEqual([]);
	});

	it('streams without materialising the match list', () => {
		let count = 0;
		AhoCorasick.build(['林轩']).forEach('林轩林轩林轩', () => { count++; });
		expect(count).toBe(3);
	});

	// A long run of one repeated character is the shape that makes a naive fail
	// walk quadratic, and Chinese punctuation runs are exactly that.
	it('stays linear on a degenerate repeated run', () => {
		const ac = AhoCorasick.build(['aaaa', 'aaa']);
		const matches = ac.findAll('a'.repeat(5000));
		expect(matches).toHaveLength(4998 + 4997);
	});

	it('matches Latin and CJK patterns in the same automaton', () => {
		expect(found(['Mulelia', '穆蕾莉亚'], 'Mulelia 就是穆蕾莉亚')).toEqual([
			['Mulelia', 0],
			['穆蕾莉亚', 10],
		]);
	});
});
