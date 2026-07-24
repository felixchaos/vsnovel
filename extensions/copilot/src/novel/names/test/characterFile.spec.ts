/*---------------------------------------------------------------------------------------------
 *  VS Novel — character file parsing tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { parseCharacter } from '../characterFile';
import { NameIndex } from '../nameIndex';

const ZHANG = `---
canonical: 张小凡
aliases: [小凡]
addresses:
  - to: li
    as: 师父
    kind: 师徒
---
青云门弟子。
`;

describe('parseCharacter', () => {
	it('reads canonical, aliases and address relations', () => {
		expect(parseCharacter('zhang', ZHANG)).toEqual({
			id: 'zhang',
			canonical: '张小凡',
			aliases: ['小凡'],
			addresses: [{ to: 'li', as: '师父', kind: '师徒', lang: undefined }],
		});
	});

	it('accepts "name" as a spelling of canonical', () => {
		expect(parseCharacter('li', '---\nname: 李慕白\n---\n剑仙。')?.canonical).toBe('李慕白');
	});

	// Without a canonical name there is nothing to drift *towards*, so the entry
	// would match nothing and report nothing — better to reject it loudly.
	it('rejects a character with no canonical name', () => {
		const onProblem = vi.fn();
		expect(parseCharacter('x', '---\naliases: [小凡]\n---\n正文', { onProblem })).toBeUndefined();
		expect(onProblem).toHaveBeenCalledWith({
			field: 'canonical',
			message: 'a character needs a canonical name; nothing else can anchor a drift report',
		});
	});

	it('reads per-language alias buckets', () => {
		const got = parseCharacter('mu', `---
canonical: 穆蕾莉亚
aliases:
  en: [Mulelia, Mu]
  ja: [ムレリア]
---
圣女。
`);
		expect(got?.aliases).toEqual({ en: ['Mulelia', 'Mu'], ja: ['ムレリア'] });
	});

	it('drops an address entry missing "to" or "as" and says which', () => {
		const onProblem = vi.fn();
		const got = parseCharacter('zhang', `---
canonical: 张小凡
addresses:
  - as: 师父
  - to: li
    as: 师尊
---
x`, { onProblem });
		expect(got?.addresses).toEqual([{ to: 'li', as: '师尊', kind: undefined, lang: undefined }]);
		expect(onProblem).toHaveBeenCalledWith({
			field: 'addresses[0]',
			message: 'both "to" (a character id) and "as" (the surface form) are required',
		});
	});

	it('reports an unknown language on an address form', () => {
		const onProblem = vi.fn();
		parseCharacter('zhang', '---\ncanonical: 张小凡\naddresses:\n  - to: li\n    as: 师父\n    lang: fr\n---\nx', { onProblem });
		expect(onProblem).toHaveBeenCalledWith({
			field: 'addresses[0].lang',
			message: 'unknown language "fr"; expected one of zh, ja, en',
		});
	});

	it('treats a file with no frontmatter as having no character', () => {
		expect(parseCharacter('x', '就是一段人物小传。')).toBeUndefined();
	});
});

describe('parsed characters drive checking end to end', () => {
	it('resolves an address form declared in a file, under that character POV', () => {
		const zhang = parseCharacter('zhang', ZHANG)!;
		const li = parseCharacter('li', '---\ncanonical: 李慕白\naliases: [慕白]\n---\n剑仙。')!;
		const ix = NameIndex.build([zhang, li]);

		expect(ix.check('师父点头。', { pov: 'zhang' }).mentions[0].characterId).toBe('li');
		expect(ix.check('师父点头。', { pov: 'li' }).mentions).toEqual([]);
	});

	it('reports drift for a character named only by an alias from their file', () => {
		const li = parseCharacter('li', '---\ncanonical: 李慕白\naliases: [慕白]\n---\n剑仙。')!;
		const got = NameIndex.build([li]).check('慕白独自上山。');
		expect(got.aliasDrift[0].canonical).toBe('李慕白');
	});
});
