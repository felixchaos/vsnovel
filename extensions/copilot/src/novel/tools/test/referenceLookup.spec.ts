/*---------------------------------------------------------------------------------------------
 *  VS Novel — the encyclopaedia response shape is a contract we do not own.
 *--------------------------------------------------------------------------------------------*/

/**
 * The fixture is a real response, captured from zh.wikipedia.org on
 * 2026-08-01 for 「民国 上海 电车」 and trimmed to two hits. A parser written
 * against a guessed shape fails the same way a changed shape does — an empty
 * list, which reads to the model as "nothing was found" rather than as a break.
 */

import { describe, expect, it } from 'vitest';
import { parseWikipediaSearch } from '../referenceLookupTool';

const REAL_RESPONSE = JSON.stringify({
	batchcomplete: '',
	continue: { sroffset: 2, continue: '-||' },
	query: {
		searchinfo: { totalhits: 473 },
		search: [
			{
				ns: 0,
				title: '英商上海电车',
				pageid: 1153416,
				snippet: '<span class="searchmatch">电车</span>路线。英商<span class="searchmatch">电车</span>公司（英租界）连同法商 La Compagnie Francaise de Tramways et d&#039;eclairage electrique de Changhai',
				timestamp: '2026-06-25T13:53:37Z',
			},
			{
				ns: 0,
				title: '上海华商电车',
				pageid: 6194284,
				snippet: '华商<span class="searchmatch">电车</span>公司于<span class="searchmatch">民国</span>元年（1912年）2月成立',
				timestamp: '2026-05-21T00:41:51Z',
			},
		],
	},
});

describe('parseWikipediaSearch', () => {

	it('reads titles, snippets and addresses out of a real response', () => {
		const hits = parseWikipediaSearch(REAL_RESPONSE, 'zh');
		expect(hits.map(h => h.title)).toEqual(['英商上海电车', '上海华商电车']);
		expect(hits[0].url).toBe('https://zh.wikipedia.org/wiki/%E8%8B%B1%E5%95%86%E4%B8%8A%E6%B5%B7%E7%94%B5%E8%BD%A6');
	});

	// The highlight markup is Wikipedia's, not content. Left in, the model reads
	// a sentence full of span tags and tends to copy them into the manuscript.
	it('strips highlight markup and entities from snippets', () => {
		const [first] = parseWikipediaSearch(REAL_RESPONSE, 'zh');
		expect(first.snippet).not.toMatch(/<span|searchmatch|&#0?39;/);
		expect(first.snippet).toContain('电车路线');
		expect(first.snippet).toContain("d'eclairage");
	});

	// A title with a space is a different URL from the same title with an
	// underscore; getting this wrong produces links that 404 on a page that
	// exists, which is worse than no link.
	it('turns spaces in a title into an underscored address', () => {
		const [hit] = parseWikipediaSearch(JSON.stringify({
			query: { search: [{ title: 'Shanghai Tramways', snippet: '' }] },
		}), 'en');
		expect(hit.url).toBe('https://en.wikipedia.org/wiki/Shanghai_Tramways');
	});

	// "No results" and "the shape changed" must not be the same value to the
	// caller, so a body without the expected container yields nothing and a
	// body that is not JSON at all throws.
	it('returns nothing for a response with no results', () => {
		expect(parseWikipediaSearch(JSON.stringify({ query: { search: [] } }), 'zh')).toEqual([]);
		expect(parseWikipediaSearch(JSON.stringify({ batchcomplete: '' }), 'zh')).toEqual([]);
	});

	it('throws on a body that is not JSON', () => {
		expect(() => parseWikipediaSearch('<!DOCTYPE html><html>blocked</html>', 'zh')).toThrow();
	});

	it('skips an entry with no title rather than emitting a broken link', () => {
		const hits = parseWikipediaSearch(JSON.stringify({
			query: { search: [{ snippet: 'orphan' }, { title: '上海', snippet: '' }] },
		}), 'zh');
		expect(hits.map(h => h.title)).toEqual(['上海']);
	});
});
