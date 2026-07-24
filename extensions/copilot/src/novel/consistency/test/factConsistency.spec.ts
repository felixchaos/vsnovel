/*---------------------------------------------------------------------------------------------
 *  VS Novel — fact consistency tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { Fact } from '../../facts/fact';
import { checkFacts } from '../factConsistency';

let seq = 0;
function f(over: Partial<Fact> & Pick<Fact, 'dimension' | 'value'>): Fact {
	return {
		id: `f${seq++}`,
		subject: 'li',
		narrativeOrder: 1000,
		...over,
	};
}

/** Chapter n, set on story day d. */
function at(chapter: number, day: number, over: Partial<Fact> & Pick<Fact, 'dimension' | 'value'>): Fact {
	return f({ narrativeOrder: chapter * 1000, storyTime: { day }, ...over });
}

describe('life transitions over story time', () => {
	it('accepts an arc that only moves forward', () => {
		expect(checkFacts([
			at(1, 10, { dimension: 'life', value: 'alive' }),
			at(3, 30, { dimension: 'life', value: '重伤' }),
			at(5, 50, { dimension: 'life', value: '身亡' }),
		])).toEqual([]);
	});

	it('reports a resurrection', () => {
		const findings = checkFacts([
			at(5, 50, { dimension: 'life', value: 'dead' }),
			at(8, 80, { dimension: 'life', value: 'alive' }),
		]);
		expect(findings).toHaveLength(1);
		expect(findings[0].kind).toBe('illegalLifeTransition');
		expect(findings[0].detail).toBe('dead → alive');
	});

	// Chapter order says the alive fact comes second. Story time says it comes
	// first. Story time wins, and nothing is reported.
	it('does not report a flashback that shows the character alive', () => {
		expect(checkFacts([
			at(5, 50, { dimension: 'life', value: 'dead' }),
			at(8, 20, { dimension: 'life', value: 'alive' }),
		])).toEqual([]);
	});
});

describe('a dead character stops acting', () => {
	// The rule the FSM alone cannot express: the contradiction is asserted on a
	// different dimension from the one that recorded the death.
	it('reports a later appearance somewhere', () => {
		const findings = checkFacts([
			at(5, 50, { dimension: 'life', value: '战死' }),
			at(8, 80, { dimension: 'location', value: '青云山' }),
		]);
		expect(findings).toHaveLength(1);
		expect(findings[0].kind).toBe('deadCharacterActs');
		expect(findings[0].detail).toBe('location=青云山');
	});

	// The whole reason the second axis exists.
	it('does not report an appearance set before the death', () => {
		expect(checkFacts([
			at(5, 50, { dimension: 'life', value: 'dead' }),
			at(8, 20, { dimension: 'location', value: '青云山' }),
		])).toEqual([]);
	});

	it('does not report an appearance at the very moment of death', () => {
		// Dying somewhere means being there. Equal times are not evidence.
		expect(checkFacts([
			at(5, 50, { dimension: 'life', value: 'dead' }),
			at(5, 50, { dimension: 'location', value: '青云山' }),
		])).toEqual([]);
	});

	// An unplaced fact cannot be shown to come after anything, and guessing that
	// it does manufactures the exact false positive this design avoids.
	it('says nothing when the later fact has no story time', () => {
		expect(checkFacts([
			at(5, 50, { dimension: 'life', value: 'dead' }),
			f({ narrativeOrder: 8000, dimension: 'location', value: '青云山' }),
		])).toEqual([]);
	});

	it('keeps subjects separate', () => {
		expect(checkFacts([
			at(5, 50, { subject: 'li', dimension: 'life', value: 'dead' }),
			at(8, 80, { subject: 'zhang', dimension: 'location', value: '青云山' }),
		])).toEqual([]);
	});
});

describe('eras', () => {
	it('cannot compare across eras without a declared order, so reports nothing', () => {
		expect(checkFacts([
			f({ narrativeOrder: 5000, storyTime: { era: '青云历', day: 50 }, dimension: 'life', value: 'dead' }),
			f({ narrativeOrder: 8000, storyTime: { era: '天元历', day: 5 }, dimension: 'location', value: '青云山' }),
		])).toEqual([]);
	});

	it('reports once the era order makes them comparable', () => {
		const findings = checkFacts([
			f({ narrativeOrder: 5000, storyTime: { era: '青云历', day: 50 }, dimension: 'life', value: 'dead' }),
			f({ narrativeOrder: 8000, storyTime: { era: '天元历', day: 5 }, dimension: 'location', value: '青云山' }),
		], { eraOrder: ['青云历', '天元历'] });
		expect(findings.map(x => x.kind)).toEqual(['deadCharacterActs']);
	});
});

describe('contradictions at one moment', () => {
	// A narrow claim, and therefore a safe one: no model of travel or duration is
	// involved, only that a thing cannot be two things at once.
	it('reports one subject in two places at the same time', () => {
		const findings = checkFacts([
			at(4, 40, { dimension: 'location', value: '青云山' }),
			at(4, 40, { dimension: 'location', value: '京城' }),
		]);
		expect(findings).toHaveLength(1);
		expect(findings[0].kind).toBe('contradictionAtSameTime');
		expect(findings[0].detail).toBe('location: 青云山 / 京城');
	});

	it('says nothing about the same value asserted twice', () => {
		expect(checkFacts([
			at(4, 40, { dimension: 'location', value: '青云山' }),
			at(4, 40, { dimension: 'location', value: '青云山' }),
		])).toEqual([]);
	});

	it('says nothing about different places at different times', () => {
		expect(checkFacts([
			at(4, 40, { dimension: 'location', value: '青云山' }),
			at(5, 41, { dimension: 'location', value: '京城' }),
		])).toEqual([]);
	});

	it('catches an item owned by two people at once', () => {
		const findings = checkFacts([
			at(4, 40, { subject: 'sword', dimension: 'possession', value: 'li' }),
			at(4, 40, { subject: 'sword', dimension: 'possession', value: 'zhang' }),
		]);
		expect(findings.map(x => x.kind)).toEqual(['contradictionAtSameTime']);
	});
});

describe('unrecognised state words', () => {
	it('reports rather than silently skipping', () => {
		const findings = checkFacts([at(1, 10, { dimension: 'life', value: '半死不活' })]);
		expect(findings.map(x => [x.kind, x.detail])).toEqual([['unknownState', '半死不活']]);
	});
});

describe('ordering', () => {
	it('returns findings in story order', () => {
		const findings = checkFacts([
			at(9, 90, { dimension: 'life', value: 'dead' }),
			at(10, 95, { dimension: 'life', value: 'alive' }),
			at(2, 20, { subject: 'x', dimension: 'location', value: 'a' }),
			at(2, 20, { subject: 'x', dimension: 'location', value: 'b' }),
		]);
		expect(findings.map(x => x.fact.storyTime?.day)).toEqual([20, 95]);
	});
});
