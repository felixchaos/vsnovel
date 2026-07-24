/*---------------------------------------------------------------------------------------------
 *  VS Novel — dual-axis fact tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
	Anchor, anchorIsIntact, byStoryTime, compareStoryTime, Fact, hashSnippet, isFlashback, resolveAnchor,
} from '../fact';

function fact(id: string, narrativeOrder: number, day?: number, era?: string): Fact {
	return {
		id,
		narrativeOrder,
		storyTime: day === undefined ? undefined : { day, era },
		subject: 'li',
		dimension: 'life',
		value: 'alive',
	};
}

describe('compareStoryTime', () => {
	it('orders days within one era', () => {
		expect(compareStoryTime({ day: 10 }, { day: 20 })).toBe(-1);
		expect(compareStoryTime({ day: 20 }, { day: 10 })).toBe(1);
		expect(compareStoryTime({ day: 10 }, { day: 10 })).toBe(0);
	});

	// "I don't know" has to be its own answer. Folding it into "not later" stops
	// the checks silently; folding it into "later" invents contradictions.
	it('refuses to compare across eras unless an order is declared', () => {
		expect(compareStoryTime({ era: '青云历', day: 4102 }, { era: '天元历', day: 3 })).toBeUndefined();
		expect(compareStoryTime({ era: '青云历', day: 4102 }, { era: '天元历', day: 3 }, ['青云历', '天元历'])).toBe(-1);
	});

	it('refuses when an era is missing from the declared order', () => {
		expect(compareStoryTime({ era: '青云历', day: 1 }, { era: '未知历', day: 1 }, ['青云历'])).toBeUndefined();
	});

	it('returns undefined when either side is unplaced', () => {
		expect(compareStoryTime(undefined, { day: 1 })).toBeUndefined();
		expect(compareStoryTime({ day: 1 }, undefined)).toBeUndefined();
	});
});

describe('isFlashback', () => {
	// The single most damaging false positive a consistency checker can produce
	// is telling an author their deliberate flashback contradicts itself.
	it('recognises a later chapter set at an earlier time', () => {
		expect(isFlashback(fact('a', 1000, 500), fact('b', 8000, 100))).toBe(true);
	});

	it('is not a flashback when story time moves forward with the chapters', () => {
		expect(isFlashback(fact('a', 1000, 100), fact('b', 8000, 500))).toBe(false);
	});

	it('is not a flashback when the later fact is told earlier', () => {
		expect(isFlashback(fact('a', 8000, 100), fact('b', 1000, 500))).toBe(false);
	});

	it('is not a flashback when the times cannot be compared', () => {
		expect(isFlashback(fact('a', 1000, 500), fact('b', 8000))).toBe(false);
	});
});

describe('byStoryTime', () => {
	it('sorts by story time, not by chapter', () => {
		const facts = [fact('told-first', 1000, 900), fact('told-later', 8000, 100)];
		expect(byStoryTime(facts).map(f => f.id)).toEqual(['told-later', 'told-first']);
	});

	// An unplaced fact cannot be shown to precede anything, so placing it last
	// is the reading that asserts least.
	it('puts unplaced facts after placed ones', () => {
		const facts = [fact('unplaced', 500), fact('placed', 9000, 100)];
		expect(byStoryTime(facts).map(f => f.id)).toEqual(['placed', 'unplaced']);
	});

	it('falls back to narrative order for equal times', () => {
		expect(byStoryTime([fact('b', 8000, 100), fact('a', 1000, 100)]).map(f => f.id)).toEqual(['a', 'b']);
	});
});

describe('hashSnippet', () => {
	it('is stable for the same text', () => {
		expect(hashSnippet('李慕白倒下了。')).toBe(hashSnippet('李慕白倒下了。'));
	});

	it('changes when the sentence changes', () => {
		expect(hashSnippet('李慕白倒下了。')).not.toBe(hashSnippet('李慕白站起来了。'));
	});

	// Reflowing a paragraph is not a rewrite of the sentence. Reporting it as one
	// would make every reformat look like drift.
	it('ignores whitespace reflow', () => {
		expect(hashSnippet('李慕白  倒下了。')).toBe(hashSnippet('李慕白 倒下了。'));
		expect(hashSnippet('  李慕白倒下了。\n')).toBe(hashSnippet('李慕白倒下了。'));
	});
});

describe('resolveAnchor', () => {
	const text = ['第一行', '李慕白倒下了。', '第三行'].join('\n');
	const anchor = (over: Partial<Anchor> = {}): Anchor => ({
		file: 'ch05.md',
		snippet: '李慕白倒下了。',
		snippetHash: hashSnippet('李慕白倒下了。'),
		line: 1,
		...over,
	});

	it('takes the fast path when the remembered line still holds', () => {
		expect(resolveAnchor(anchor(), text)).toEqual({ status: 'exact', line: 1, offset: 4 });
	});

	// The reason offsets were rejected: the author inserts above it every day.
	it('finds the snippet after lines were inserted above it', () => {
		const shifted = ['新插入的一段', '又一段', ...text.split('\n')].join('\n');
		const got = resolveAnchor(anchor(), shifted);
		expect(got.status).toBe('moved');
		expect(got.line).toBe(3);
	});

	it('reports lost when the sentence was rewritten away', () => {
		expect(resolveAnchor(anchor(), '第一行\n李慕白笑了笑。\n第三行')).toEqual({ status: 'lost' });
	});

	it('still finds the snippet when no line hint was stored', () => {
		expect(resolveAnchor(anchor({ line: undefined }), text).status).toBe('moved');
	});

	it('slices back to the snippet at the reported offset', () => {
		const got = resolveAnchor(anchor(), text);
		expect(text.slice(got.offset, got.offset! + 7)).toBe('李慕白倒下了。');
	});
});

describe('anchorIsIntact', () => {
	it('detects a snippet edited after the fact was recorded', () => {
		const recorded = hashSnippet('李慕白倒下了。');
		expect(anchorIsIntact({ file: 'a.md', snippet: '李慕白倒下了。', snippetHash: recorded })).toBe(true);
		expect(anchorIsIntact({ file: 'a.md', snippet: '李慕白站起来了。', snippetHash: recorded })).toBe(false);
	});
});
