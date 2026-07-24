/*---------------------------------------------------------------------------------------------
 *  VS Novel — fact/foreshadow file loading tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseFactsFile, parseForeshadowFile } from '../factFile';

describe('parseFactsFile', () => {
	it('reads a complete fact', () => {
		const { entries, problems } = parseFactsFile(JSON.stringify([{
			id: 'ev-7c1a',
			narrativeOrder: 2000,
			storyTime: { era: '青云历', day: 4102 },
			anchor: { file: 'ch05.md', snippet: '李慕白倒下了。', snippetHash: 'a3f10000', line: 88 },
			subject: 'li', dimension: 'life', value: '身亡',
		}]));
		expect(problems).toEqual([]);
		expect(entries[0].storyTime).toEqual({ era: '青云历', day: 4102 });
		expect(entries[0].anchor?.line).toBe(88);
	});

	// One malformed entry in a file of four hundred must cost that entry — not
	// the file, and certainly not the whole consistency pass.
	it('skips a bad entry and keeps the good ones', () => {
		const { entries, problems } = parseFactsFile(JSON.stringify([
			{ id: 'a', narrativeOrder: 1, subject: 's', dimension: 'life', value: 'alive' },
			{ id: 'b', narrativeOrder: 'soon', subject: 's', dimension: 'life', value: 'dead' },
			{ id: 'c', narrativeOrder: 3, subject: 's', dimension: 'life', value: 'dead' },
		]));
		expect(entries.map(e => e.id)).toEqual(['a', 'c']);
		expect(problems).toEqual([{ at: 1, message: 'b: narrativeOrder must be a number' }]);
	});

	it('requires the three fields that make a fact assert anything', () => {
		const { entries, problems } = parseFactsFile(JSON.stringify([{ id: 'a', narrativeOrder: 1, subject: 's' }]));
		expect(entries).toEqual([]);
		expect(problems[0].message).toBe('a: subject, dimension and value are all required');
	});

	it('drops a malformed anchor without dropping the fact', () => {
		const { entries } = parseFactsFile(JSON.stringify([{
			id: 'a', narrativeOrder: 1, subject: 's', dimension: 'life', value: 'alive',
			anchor: { file: 'ch01.md' },
		}]));
		expect(entries[0].anchor).toBeUndefined();
	});

	// Reporting "no problems" for an unreadable file is the worst possible
	// failure: it looks exactly like a manuscript with nothing wrong in it.
	it('reports invalid JSON rather than returning an empty set', () => {
		expect(parseFactsFile('{not json').problems[0].at).toBe(-1);
		expect(parseFactsFile('{"a":1}').problems[0].message).toBe('expected an array of facts');
	});
});

describe('parseForeshadowFile', () => {
	it('reads a complete entry', () => {
		const { entries, problems } = parseForeshadowFile(JSON.stringify([{
			id: 'fs-sword', title: '断剑的来历', plantedAt: 3000,
			window: { from: 5000, to: 12000 },
			prerequisites: [{ kind: 'factExists', subject: 'sword', dimension: 'possession', value: 'li' }],
		}]));
		expect(problems).toEqual([]);
		expect(entries[0].window).toEqual({ from: 5000, to: 12000 });
		expect(entries[0].prerequisites).toHaveLength(1);
	});

	it('falls back to the id when no title is given', () => {
		const { entries } = parseForeshadowFile(JSON.stringify([{ id: 'fs-1', plantedAt: 1 }]));
		expect(entries[0].title).toBe('fs-1');
	});

	// A condition this build does not know must survive the round trip: dropping
	// it would silently turn a blocked thread into a firable one.
	it('keeps an unrecognised condition kind', () => {
		const { entries } = parseForeshadowFile(JSON.stringify([{
			id: 'fs-1', plantedAt: 1, prerequisites: [{ kind: 'someFutureKind', x: 1 }],
		}]));
		expect(entries[0].prerequisites).toEqual([{ kind: 'someFutureKind', x: 1 }]);
	});

	it('drops a condition with no kind', () => {
		const { entries } = parseForeshadowFile(JSON.stringify([{
			id: 'fs-1', plantedAt: 1, prerequisites: [{ nope: true }, { kind: 'flag', flag: 'a' }],
		}]));
		expect(entries[0].prerequisites).toEqual([{ kind: 'flag', flag: 'a' }]);
	});

	it('reports an entry with no plantedAt', () => {
		const { entries, problems } = parseForeshadowFile(JSON.stringify([{ id: 'fs-1' }]));
		expect(entries).toEqual([]);
		expect(problems[0].message).toBe('fs-1: plantedAt must be a number');
	});
});
