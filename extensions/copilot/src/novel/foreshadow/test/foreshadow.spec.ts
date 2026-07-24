/*---------------------------------------------------------------------------------------------
 *  VS Novel — foreshadowing tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { Fact } from '../../facts/fact';
import { Condition, evalCondition, firable, Foreshadow, isFirable, overdue, WorldView } from '../foreshadow';

function world(over: Partial<WorldView> = {}): WorldView {
	return { position: 10_000, ...over };
}

function thread(id: string, over: Partial<Foreshadow> = {}): Foreshadow {
	return { id, title: id, plantedAt: 3_000, ...over };
}

const SWORD_FOUND: Fact = {
	id: 'fact-1', subject: 'sword', dimension: 'possession', value: 'li', narrativeOrder: 5_000,
};

describe('evalCondition', () => {
	it('reads an author-set flag', () => {
		const condition: Condition = { kind: 'flag', flag: '玄冥子现身' };
		expect(evalCondition(condition, world({ flags: new Set(['玄冥子现身']) }))).toBe(true);
		expect(evalCondition(condition, world())).toBe(false);
	});

	it('checks a fact by subject and dimension, with an optional value', () => {
		const facts = [SWORD_FOUND];
		expect(evalCondition({ kind: 'factExists', subject: 'sword', dimension: 'possession' }, world({ facts }))).toBe(true);
		expect(evalCondition({ kind: 'factExists', subject: 'sword', dimension: 'possession', value: 'li' }, world({ facts }))).toBe(true);
		expect(evalCondition({ kind: 'factExists', subject: 'sword', dimension: 'possession', value: 'zhang' }, world({ facts }))).toBe(false);
	});

	it('checks how far the manuscript has come', () => {
		expect(evalCondition({ kind: 'chapterAfter', narrativeOrder: 8_000 }, world({ position: 10_000 }))).toBe(true);
		expect(evalCondition({ kind: 'chapterAfter', narrativeOrder: 12_000 }, world({ position: 10_000 }))).toBe(false);
	});

	it('checks whether another thread was paid off', () => {
		const condition: Condition = { kind: 'foreshadowPaidOff', id: 'fs-1' };
		expect(evalCondition(condition, world({ paidOff: new Set(['fs-1']) }))).toBe(true);
		expect(evalCondition(condition, world())).toBe(false);
	});

	// A workspace written against a later version must still load and be
	// checkable, with the unknown condition simply never satisfied.
	it('returns false for a condition kind it does not know', () => {
		expect(evalCondition({ kind: 'someFutureKind' }, world())).toBe(false);
	});
});

describe('isFirable', () => {
	it('is firable when every prerequisite holds', () => {
		const entry = thread('fs', { prerequisites: [{ kind: 'flag', flag: 'a' }, { kind: 'chapterAfter', narrativeOrder: 5_000 }] });
		expect(isFirable(entry, world({ flags: new Set(['a']), position: 6_000 }))).toBe(true);
	});

	it('is not firable while any prerequisite is unmet', () => {
		const entry = thread('fs', { prerequisites: [{ kind: 'flag', flag: 'a' }, { kind: 'flag', flag: 'b' }] });
		expect(isFirable(entry, world({ flags: new Set(['a']) }))).toBe(false);
	});

	it('is firable with no prerequisites at all', () => {
		expect(isFirable(thread('fs'), world())).toBe(true);
	});

	it('is not firable once written', () => {
		expect(isFirable(thread('fs', { paidOffAt: 9_000 }), world())).toBe(false);
	});

	it('respects the earliest point the author allowed', () => {
		const entry = thread('fs', { window: { from: 12_000 } });
		expect(isFirable(entry, world({ position: 10_000 }))).toBe(false);
		expect(isFirable(entry, world({ position: 12_000 }))).toBe(true);
	});

	// Being late is a reason to write it, not a reason to forbid it.
	it('stays firable after its deadline', () => {
		expect(isFirable(thread('fs', { window: { to: 5_000 } }), world({ position: 10_000 }))).toBe(true);
	});
});

describe('overdue', () => {
	it('reports a thread past its deadline', () => {
		const got = overdue([thread('fs', { window: { to: 6_000 } })], world({ position: 10_000 }));
		expect(got).toHaveLength(1);
		expect(got[0].by).toBe(4_000);
	});

	it('says nothing about a thread that was paid off', () => {
		expect(overdue([thread('fs', { window: { to: 6_000 }, paidOffAt: 7_000 })], world({ position: 10_000 }))).toEqual([]);
	});

	// No deadline means the author never promised one, and no amount of elapsed
	// manuscript makes it late.
	it('says nothing about a thread with no deadline', () => {
		expect(overdue([thread('fs')], world({ position: 999_000 }))).toEqual([]);
	});

	it('says nothing before the deadline', () => {
		expect(overdue([thread('fs', { window: { to: 20_000 } })], world({ position: 10_000 }))).toEqual([]);
	});

	// Overdue-and-firable is a thread the author forgot; overdue-and-blocked
	// usually means the plan needs revisiting. Showing them identically hides that.
	it('reports which prerequisites are still blocking it', () => {
		const entry = thread('fs', {
			window: { to: 6_000 },
			prerequisites: [{ kind: 'flag', flag: 'met' }, { kind: 'flag', flag: 'found' }],
		});
		const got = overdue([entry], world({ position: 10_000, flags: new Set(['met']) }));
		expect(got[0].blockedBy).toEqual([{ kind: 'flag', flag: 'found' }]);
	});

	it('reports nothing blocking when the thread was simply forgotten', () => {
		const entry = thread('fs', { window: { to: 6_000 }, prerequisites: [{ kind: 'flag', flag: 'met' }] });
		expect(overdue([entry], world({ position: 10_000, flags: new Set(['met']) }))[0].blockedBy).toEqual([]);
	});

	it('puts the longest-waiting promise first', () => {
		const got = overdue([
			thread('recent', { window: { to: 9_000 } }),
			thread('ancient', { window: { to: 2_000 } }),
		], world({ position: 10_000 }));
		expect(got.map(o => o.entry.id)).toEqual(['ancient', 'recent']);
	});
});

describe('firable', () => {
	it('lists what could be written now, oldest promise first', () => {
		const entries = [
			thread('late', { plantedAt: 8_000 }),
			thread('early', { plantedAt: 1_000 }),
			thread('blocked', { plantedAt: 2_000, prerequisites: [{ kind: 'flag', flag: 'nope' }] }),
			thread('done', { plantedAt: 500, paidOffAt: 9_000 }),
		];
		expect(firable(entries, world()).map(e => e.id)).toEqual(['early', 'late']);
	});
});

describe('a full thread, planted to paid off', () => {
	it('moves from blocked to firable to done', () => {
		const entry = thread('fs-sword', {
			plantedAt: 3_000,
			window: { from: 5_000, to: 12_000 },
			prerequisites: [{ kind: 'factExists', subject: 'sword', dimension: 'possession', value: 'li' }],
		});

		// Too early, and the prerequisite has not happened.
		expect(isFirable(entry, world({ position: 4_000 }))).toBe(false);
		// The sword is found, but the window has not opened.
		expect(isFirable(entry, world({ position: 4_000, facts: [SWORD_FOUND] }))).toBe(false);
		// Both hold.
		expect(isFirable(entry, world({ position: 6_000, facts: [SWORD_FOUND] }))).toBe(true);
		// Past the deadline, still unwritten.
		expect(overdue([entry], world({ position: 13_000, facts: [SWORD_FOUND] }))).toHaveLength(1);
		// Written.
		const done = { ...entry, paidOffAt: 13_500 };
		expect(overdue([done], world({ position: 14_000 }))).toEqual([]);
		expect(isFirable(done, world({ position: 14_000 }))).toBe(false);
	});
});
