/*---------------------------------------------------------------------------------------------
 *  VS Novel — life-state machine tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { checkLifeSequence, checkLifeTransition, normalizeLifeState } from '../lifeFsm';

describe('normalizeLifeState', () => {
	it('accepts the canonical states as themselves', () => {
		expect(normalizeLifeState('dead')).toBe('dead');
		expect(normalizeLifeState('ALIVE')).toBe('alive');
	});

	// The same manuscript is three languages, and a translated chapter must land
	// on the same canonical state or every character's status appears to change
	// the moment the language does.
	it('maps Chinese state words', () => {
		for (const word of ['死亡', '身亡', '已故', '战死', '殒命']) {
			expect(normalizeLifeState(word)).toBe('dead');
		}
		expect(normalizeLifeState('重伤')).toBe('injured');
		expect(normalizeLifeState('下落不明')).toBe('missing');
	});

	it('maps Japanese state words', () => {
		for (const word of ['死去', '亡くなる', '他界']) {
			expect(normalizeLifeState(word)).toBe('dead');
		}
		expect(normalizeLifeState('行方不明')).toBe('missing');
		expect(normalizeLifeState('負傷')).toBe('injured');
	});

	it('maps English state words including multi-word ones', () => {
		expect(normalizeLifeState('passed away')).toBe('dead');
		expect(normalizeLifeState('Deceased')).toBe('dead');
		expect(normalizeLifeState('wounded')).toBe('injured');
	});

	// A word quietly parsed as the wrong state is worse than one the author is
	// asked about.
	it('returns undefined rather than guessing', () => {
		expect(normalizeLifeState('半死不活')).toBeUndefined();
		expect(normalizeLifeState('')).toBeUndefined();
	});
});

describe('checkLifeTransition', () => {
	it('allows movement among the non-terminal states', () => {
		expect(checkLifeTransition('alive', 'injured').ok).toBe(true);
		expect(checkLifeTransition('missing', 'alive').ok).toBe(true);
		expect(checkLifeTransition('unknown', 'dead').ok).toBe(true);
	});

	it('treats dead as terminal', () => {
		expect(checkLifeTransition('dead', 'alive')).toEqual({
			code: 'illegalTransition', ok: false, from: 'dead', to: 'alive',
		});
		expect(checkLifeTransition('dead', 'dead').ok).toBe(true);
	});

	// The finding must be the same in either language, or a bilingual manuscript
	// reports differently depending on which chapter it is read from.
	it('normalises both sides, so the finding is language-independent', () => {
		expect(checkLifeTransition('身亡', 'alive')).toEqual({
			code: 'illegalTransition', ok: false, from: 'dead', to: 'alive',
		});
		expect(checkLifeTransition('dead', '活着').code).toBe('illegalTransition');
		expect(checkLifeTransition('他界', '生存').code).toBe('illegalTransition');
	});

	it('reports an unrecognised word instead of failing silently', () => {
		expect(checkLifeTransition('alive', '半死不活')).toEqual({
			code: 'unknownState', ok: false, raw: '半死不活',
		});
	});
});

describe('checkLifeSequence', () => {
	it('passes a legal arc', () => {
		expect(checkLifeSequence(['alive', '重伤', '下落不明', 'alive', '战死'])).toEqual([]);
	});

	// A character who dies twice and revives twice is a different manuscript
	// problem from one who revives once. Stopping at the first hides that.
	it('reports every illegal step, not just the first', () => {
		const verdicts = checkLifeSequence(['alive', 'dead', 'alive', 'dead', 'injured']);
		expect(verdicts).toHaveLength(2);
		expect(verdicts.map(v => [v.from, v.to])).toEqual([['dead', 'alive'], ['dead', 'injured']]);
	});

	// Refusing to advance past a bad step would report every later state against
	// the pre-death one and bury the real finding under a cascade.
	it('advances past an illegal step rather than cascading', () => {
		const verdicts = checkLifeSequence(['dead', 'alive', 'injured', 'missing']);
		expect(verdicts).toHaveLength(1);
		expect(verdicts[0].to).toBe('alive');
	});

	it('reports an unrecognised word and keeps going', () => {
		const verdicts = checkLifeSequence(['alive', '半死不活', 'dead']);
		expect(verdicts).toEqual([{ code: 'unknownState', ok: false, raw: '半死不活' }]);
	});

	it('says nothing about an empty or single-state history', () => {
		expect(checkLifeSequence([])).toEqual([]);
		expect(checkLifeSequence(['dead'])).toEqual([]);
	});
});
