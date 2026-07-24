/*---------------------------------------------------------------------------------------------
 *  VS Novel — name resolution and drift tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { Character, NameIndex } from '../nameIndex';

const LI: Character = { id: 'li', canonical: '李慕白', aliases: ['慕白', '李剑仙'] };
const ZHANG: Character = {
	id: 'zhang',
	canonical: '张小凡',
	aliases: ['小凡'],
	addresses: [{ to: 'li', as: '师父', kind: '师徒' }],
};

function index(...characters: Character[]): NameIndex {
	return NameIndex.build(characters.length ? characters : [LI, ZHANG]);
}

describe('resolve', () => {
	it('resolves a canonical name and an alias to the same character', () => {
		const ix = index();
		expect(ix.resolve('李慕白')).toBe('li');
		expect(ix.resolve('慕白')).toBe('li');
	});

	it('returns undefined for an unregistered form rather than guessing', () => {
		expect(index().resolve('那男人')).toBeUndefined();
	});

	it('resolves an address form only under the point of view that uses it', () => {
		const ix = index();
		expect(ix.resolve('师父', { pov: 'zhang' })).toBe('li');
		// In someone else's scene 师父 means someone else. Resolving it here would
		// invent a fact.
		expect(ix.resolve('师父', { pov: 'li' })).toBeUndefined();
		expect(ix.resolve('师父')).toBeUndefined();
	});

	it('leaves a shared alias unresolved instead of picking one', () => {
		const ix = index(
			{ id: 'a', canonical: '甲', aliases: ['小师弟'] },
			{ id: 'b', canonical: '乙', aliases: ['小师弟'] },
		);
		expect(ix.resolve('小师弟')).toBeUndefined();
	});
});

describe('check — mentions', () => {
	it('finds canonical and alias mentions in document order', () => {
		const got = index().check('李慕白转身，慕白叹了口气。');
		expect(got.mentions.map(m => [m.surface, m.kind, m.start])).toEqual([
			['李慕白', 'canonical', 0],
			['慕白', 'alias', 6],
		]);
	});

	// 李慕白 must be one mention, not 李慕白 plus a nested 慕白 — otherwise every
	// full name also reports as an alias use of itself.
	it('prefers the longest form when surfaces nest', () => {
		const got = index().check('李慕白提剑');
		expect(got.mentions).toHaveLength(1);
		expect(got.mentions[0].surface).toBe('李慕白');
		expect(got.mentions[0].kind).toBe('canonical');
	});

	it('resolves an address form to its target under the right POV', () => {
		const got = index().check('师父，我错了。', { pov: 'zhang' });
		expect(got.mentions.map(m => [m.characterId, m.kind])).toEqual([['li', 'address']]);
	});

	it('ignores an address form outside its POV', () => {
		expect(index().check('师父，我错了。', { pov: 'li' }).mentions).toEqual([]);
	});

	it('reports offsets that slice back to the surface', () => {
		const prose = '那日，李慕白提剑而来。';
		const [mention] = index().check(prose).mentions;
		expect(prose.slice(mention.start, mention.end)).toBe('李慕白');
	});
});

describe('check — alias drift', () => {
	// The actual complaint: the author slid into calling him 慕白 and never wrote
	// the real name, so a reader landing on this chapter has no anchor.
	it('reports a character named only by alias', () => {
		const got = index().check('慕白站在雨里，李剑仙的剑还在鞘中。');
		expect(got.aliasDrift).toHaveLength(1);
		expect(got.aliasDrift[0].canonical).toBe('李慕白');
		expect(got.aliasDrift[0].mentions.map(m => m.surface)).toEqual(['慕白', '李剑仙']);
	});

	it('reports nothing when the canonical name is present too', () => {
		expect(index().check('李慕白转身，慕白叹了口气。').aliasDrift).toEqual([]);
	});

	// 师父 is how the viewpoint character thinks of him. Demanding the full name
	// there would be bad prose advice, not a consistency finding.
	it('does not treat an address form as drift', () => {
		expect(index().check('师父点了点头。', { pov: 'zhang' }).aliasDrift).toEqual([]);
	});
});

describe('check — cast', () => {
	it('reports a cast member who is never named', () => {
		const got = index().check('李慕白独自上山。', { cast: ['li', 'zhang'] });
		expect(got.castUnmentioned).toEqual(['zhang']);
	});

	it('reports nothing when everyone present is named', () => {
		expect(index().check('李慕白与张小凡同行。', { cast: ['li', 'zhang'] }).castUnmentioned).toEqual([]);
	});
});

describe('check — ambiguity', () => {
	it('surfaces an ambiguous form instead of resolving it', () => {
		const ix = index(
			{ id: 'a', canonical: '甲', aliases: ['小师弟'] },
			{ id: 'b', canonical: '乙', aliases: ['小师弟'] },
		);
		const got = ix.check('小师弟来了。');
		expect(got.mentions).toEqual([]);
		expect(got.ambiguous).toEqual([{ surface: '小师弟', characterIds: ['a', 'b'] }]);
	});
});

describe('Latin and Japanese handling', () => {
	const MU: Character = { id: 'mu', canonical: 'Mulelia', aliases: ['Mu'] };

	// The predecessor claimed to fold case and did not, and matched by pure
	// substring. Both bugs bite exactly on names.
	it('folds case for Latin names', () => {
		expect(NameIndex.build([MU]).check('MULELIA spoke.').mentions[0].characterId).toBe('mu');
	});

	it('requires word boundaries so a short alias cannot match inside a word', () => {
		const ix = NameIndex.build([MU]);
		expect(ix.check('The music stopped.').mentions).toEqual([]);
		expect(ix.check('Mu drew her blade.').mentions).toHaveLength(1);
	});

	it('still matches CJK by substring, which has no separators', () => {
		expect(index().check('那是李慕白啊').mentions).toHaveLength(1);
	});

	it('separates alias buckets by language', () => {
		const ix = NameIndex.build([
			{ id: 'mu', canonical: '穆蕾莉亚', aliases: { en: ['Mulelia'], ja: ['ムレリア'] } },
		]);
		expect(ix.check('Mulelia walked in', { lang: 'en' }).mentions).toHaveLength(1);
		expect(ix.check('Mulelia walked in', { lang: 'ja' }).mentions).toEqual([]);
		// The canonical form carries no bucket, so it matches in any language.
		expect(ix.check('穆蕾莉亚走进来', { lang: 'ja' }).mentions).toHaveLength(1);
	});
});

describe('scale', () => {
	// The point of the automaton: cost follows the text being edited, not the
	// number of characters the series has accumulated.
	it('scans a large cast over a long passage in one pass', () => {
		const cast = Array.from({ length: 400 }, (_, i): Character => ({
			id: `c${i}`,
			canonical: `角色${i}`,
			aliases: [`别名${i}`],
		}));
		const ix = NameIndex.build(cast);
		const prose = '风雪连天，'.repeat(2000) + '角色7走了过来。';
		const got = ix.check(prose);
		expect(got.mentions).toHaveLength(1);
		expect(got.mentions[0].characterId).toBe('c7');
	});
});
