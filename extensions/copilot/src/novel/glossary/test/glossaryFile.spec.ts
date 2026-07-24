/*---------------------------------------------------------------------------------------------
 *  VS Novel — a bad entry costs that entry.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseGlossaryFile } from '../glossaryFile';

describe('parsing a glossary file', () => {

	it('reads a well-formed file', () => {
		const { entries, problems } = parseGlossaryFile(JSON.stringify({
			terms: [{ source: 'Mulelia', target: '穆蕾莉亚', variants: ['穆雷利亚'], note: 'le, not lei' }],
		}));
		expect(problems).toEqual([]);
		expect(entries).toEqual([{ source: 'Mulelia', target: '穆蕾莉亚', variants: ['穆雷利亚'], note: 'le, not lei' }]);
	});

	it('accepts a bare array as well as the wrapper', () => {
		const { entries } = parseGlossaryFile(JSON.stringify([{ source: 'A', target: '甲' }]));
		expect(entries).toHaveLength(1);
	});

	// The whole point of the shape. A glossary that refuses to load takes every
	// other pinned rendering with it, and the result looks like a clean draft.
	it('keeps the sound entries when one is malformed', () => {
		const { entries, problems } = parseGlossaryFile(JSON.stringify({
			terms: [
				{ source: 'Mulelia', target: '穆蕾莉亚' },
				{ source: 'Broken' },
				'not an object',
				{ source: 'Aeneth', target: '艾涅斯' },
			],
		}));
		expect(entries.map(e => e.source)).toEqual(['Mulelia', 'Aeneth']);
		expect(problems.map(p => p.at)).toEqual([1, 2]);
		expect(problems[0].message).toMatch(/needs both/);
	});

	it('drops blank variants rather than matching everywhere', () => {
		const { entries } = parseGlossaryFile(JSON.stringify({
			terms: [{ source: 'A', target: '甲', variants: ['', '  ', '乙'] }],
		}));
		expect(entries[0].variants).toEqual(['乙']);
	});

	it('reports a file that is not JSON at all', () => {
		const { entries, problems } = parseGlossaryFile('source: Mulelia\ntarget: 穆蕾莉亚');
		expect(entries).toEqual([]);
		expect(problems[0].at).toBe(-1);
		expect(problems[0].message).toMatch(/not valid JSON/);
	});

	it('reports a file whose shape is neither', () => {
		expect(parseGlossaryFile('{"glossary":[]}').problems[0].message).toMatch(/expected an array/);
	});
});
