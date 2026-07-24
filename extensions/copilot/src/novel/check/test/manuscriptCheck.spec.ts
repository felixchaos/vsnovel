/*---------------------------------------------------------------------------------------------
 *  VS Novel — the agent can check its own work.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { checkManuscript } from '../manuscriptCheck';
import type { Fact } from '../../facts/fact';
import type { Character } from '../../names/nameIndex';

const CHARACTERS: Character[] = [
	{ id: 'mulelia', canonical: '穆蕾莉亚', aliases: { zh: ['大小姐'] } },
];

const GLOSSARY = {
	terms: [{ source: 'Mulelia', target: '穆蕾莉亚', variants: ['穆雷利亚'] }],
};

function fact(over: Partial<Fact> & Pick<Fact, 'id' | 'narrativeOrder' | 'subject' | 'dimension' | 'value'>): Fact {
	return over as Fact;
}

describe('checking a manuscript without an editor', () => {

	it('finds a glossary violation in the file it was given', () => {
		const findings = checkManuscript(
			[{ path: '第三章.md', text: '穆雷利亚站在城门下。' }],
			{ glossary: GLOSSARY },
		);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({ kind: 'glossary', file: '第三章.md', start: 0 });
		expect(findings[0].message).toContain('穆蕾莉亚');
	});

	it('says nothing about a clean chapter', () => {
		expect(checkManuscript(
			[{ path: '第三章.md', text: '穆蕾莉亚站在城门下。' }],
			{ characters: CHARACTERS, glossary: GLOSSARY },
		)).toEqual([]);
	});

	// The reason this exists rather than reading the Problems panel: the panel
	// follows the author's settings and covers the files they have open, and the
	// agent needs to check a chapter it just wrote into a file nobody opened.
	it('checks a file that is not open anywhere', () => {
		const findings = checkManuscript(
			[{ path: '未打开的章节.md', text: '穆雷利亚走了。' }],
			{ glossary: GLOSSARY },
		);
		expect(findings[0].file).toBe('未打开的章节.md');
	});

	it('checks every file it was given', () => {
		const findings = checkManuscript([
			{ path: 'a.md', text: '穆雷利亚。' },
			{ path: 'b.md', text: '穆蕾莉亚。' },
			{ path: 'c.md', text: 'Mulelia。' },
		], { glossary: GLOSSARY });
		expect(findings.map(f => f.file)).toEqual(['a.md', 'c.md']);
	});

	// A contradiction between two chapters belongs to neither, and filing it
	// under one would send the agent to edit the half that is probably right.
	it('reports a book-level contradiction without a file', () => {
		const findings = checkManuscript([], {
			facts: [
				fact({ id: 'f1', narrativeOrder: 5000, subject: 'mulelia', dimension: 'life', value: 'dead' }),
				fact({ id: 'f2', narrativeOrder: 8000, subject: 'mulelia', dimension: 'life', value: 'alive' }),
			],
		});
		expect(findings).toHaveLength(1);
		expect(findings[0].kind).toBe('consistency');
		expect(findings[0].file).toBeUndefined();
	});

	// Book-level checks read the records, not the prose, so asking about one
	// chapter still surfaces the contradiction that chapter just created.
	it('returns book-level findings even when asked about one chapter', () => {
		const findings = checkManuscript([{ path: '第八章.md', text: '她还活着。' }], {
			facts: [
				fact({ id: 'f1', narrativeOrder: 5000, subject: 'mulelia', dimension: 'life', value: 'dead' }),
				fact({ id: 'f2', narrativeOrder: 8000, subject: 'mulelia', dimension: 'life', value: 'alive' }),
			],
		});
		expect(findings.some(f => f.kind === 'consistency')).toBe(true);
	});
});

describe('a missing record set skips its check', () => {

	// An author with a glossary but no character files should still get glossary
	// findings. A check that cannot run must not take the ones that can with it.
	it('runs the glossary with no characters recorded', () => {
		expect(checkManuscript([{ path: 'a.md', text: '穆雷利亚。' }], { glossary: GLOSSARY })).toHaveLength(1);
	});

	it('runs nothing at all when nothing is recorded', () => {
		expect(checkManuscript([{ path: 'a.md', text: '穆雷利亚。' }], {})).toEqual([]);
	});

	it('tolerates being asked about no files', () => {
		expect(checkManuscript([], { characters: CHARACTERS, glossary: GLOSSARY })).toEqual([]);
	});
});
