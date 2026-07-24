/*---------------------------------------------------------------------------------------------
 *  VS Novel — record-from-selection tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { anchorIsIntact, resolveAnchor } from '../../facts/fact';
import {
	CHAPTER_STRIDE, chapterNumberOf, idFor, narrativeOrderFor, recordFact, recordForeshadow, uniqueAnchorText,
} from '../recordFact';

const CHAPTER = [
	'---', 'chapter: 5', '---',
	'李慕白提剑而立。',
	'风雪压境，李慕白没有回头。',
	'那一剑之后，李慕白倒下了。',
].join('\n');

function selectionOf(needle: string, text = CHAPTER, occurrence = 1) {
	let at = -1;
	for (let i = 0; i < occurrence; i++) {
		at = text.indexOf(needle, at + 1);
	}
	return { file: 'ch05.md', text, start: at, end: at + needle.length, chapter: 5 };
}

describe('uniqueAnchorText', () => {
	// The predecessor anchored on the first occurrence, so a fact about a name
	// that appears twenty times in a chapter pointed at the wrong one almost
	// every time — a link that looks live and lands somewhere the author did not
	// mean, which is worse than no link.
	it('grows an ambiguous selection until it identifies one place', () => {
		const sel = selectionOf('李慕白', CHAPTER, 3);
		const got = uniqueAnchorText(CHAPTER, sel.start, sel.end);
		expect(got.unique).toBe(true);
		expect(got.snippet).toContain('倒下了');
		expect(CHAPTER.indexOf(got.snippet)).toBe(got.start);
	});

	it('leaves an already-unique selection alone', () => {
		const sel = selectionOf('风雪压境');
		expect(uniqueAnchorText(CHAPTER, sel.start, sel.end)).toMatchObject({ snippet: '风雪压境', unique: true });
	});

	// A repeated refrain in a chapter-sized text cannot be made unique without
	// an anchor so long that any edit invalidates it. Reporting that is better
	// than silently recording one that resolves to the wrong stanza.
	it('reports when even the widest window is still ambiguous', () => {
		const refrain = '风又起了。\n'.repeat(100);
		const got = uniqueAnchorText(refrain, 0, 5);
		expect(got.unique).toBe(false);
		// And it stopped growing rather than swallowing the chapter.
		expect(got.snippet.length).toBeLessThan(refrain.length);
	});

	it('produces an anchor that resolves back to where it came from', () => {
		const sel = selectionOf('李慕白', CHAPTER, 2);
		const { anchor } = recordFact({ ...sel, subject: 'li', dimension: 'life', value: 'alive' }).fact;
		const resolved = resolveAnchor(anchor!, CHAPTER);
		expect(resolved.status).toBe('exact');
		expect(CHAPTER.slice(resolved.offset, resolved.offset! + anchor!.snippet.length)).toBe(anchor!.snippet);
	});
});

describe('recordFact', () => {
	it('computes everything the author would otherwise have to type', () => {
		const { fact } = recordFact({
			...selectionOf('李慕白倒下了。'),
			subject: 'li', dimension: 'life', value: '身亡',
			storyTime: { era: '青云历', day: 4102 },
		});

		expect(fact.id).toMatch(/^ev-[0-9a-f]{8}$/);
		expect(fact.anchor?.file).toBe('ch05.md');
		expect(fact.anchor?.snippetHash).toHaveLength(8);
		expect(anchorIsIntact(fact.anchor!)).toBe(true);
		expect(fact.narrativeOrder).toBeGreaterThanOrEqual(5 * CHAPTER_STRIDE);
		expect(fact.storyTime).toEqual({ era: '青云历', day: 4102 });
	});

	it('flags a selection whose anchor could not be made unique', () => {
		const refrain = '风又起了。\n'.repeat(100);
		const got = recordFact({
			file: 'ch09.md', text: refrain, start: 0, end: 5, chapter: 9,
			subject: 'x', dimension: 'weather', value: 'wind',
		});
		expect(got.anchorIsUnique).toBe(false);
	});
});

describe('recordForeshadow', () => {
	it('records the plant site and carries the author payoff plan through', () => {
		const { entry } = recordForeshadow({
			...selectionOf('风雪压境'),
			title: '风雪的来历',
			prerequisites: [{ kind: 'flag', flag: '玄冥子现身' }],
			window: { to: 40 * CHAPTER_STRIDE },
		});

		expect(entry.id).toMatch(/^fs-/);
		expect(entry.title).toBe('风雪的来历');
		expect(entry.prerequisites).toEqual([{ kind: 'flag', flag: '玄冥子现身' }]);
		expect(entry.window?.to).toBe(40_000);
	});

	it('falls back to the anchored text when no title is given', () => {
		expect(recordForeshadow({ ...selectionOf('风雪压境'), title: '  ' }).entry.title).toBe('风雪压境');
	});
});

describe('narrativeOrderFor', () => {
	it('puts a chapter in its own thousand', () => {
		const order = narrativeOrderFor(selectionOf('李慕白提剑而立。'));
		expect(Math.floor(order / CHAPTER_STRIDE)).toBe(5);
	});

	it('keeps two records in the order they appear in the chapter', () => {
		const first = narrativeOrderFor(selectionOf('李慕白提剑而立。'));
		const last = narrativeOrderFor(selectionOf('李慕白倒下了。'));
		expect(last).toBeGreaterThan(first);
	});

	// Inserting a chapter later must not renumber anything already recorded.
	it('leaves a gap between chapters', () => {
		const ch5 = narrativeOrderFor(selectionOf('李慕白倒下了。'));
		const ch6 = narrativeOrderFor({ ...selectionOf('李慕白提剑而立。'), chapter: 6 });
		expect(ch6).toBeGreaterThan(ch5);
	});
});

describe('idFor', () => {
	// A random id would hide duplicates, and the record would accumulate
	// near-identical entries that each have to be reviewed.
	it('is stable for the same anchored sentence', () => {
		const anchor = { file: 'ch05.md', snippet: '李慕白倒下了。', snippetHash: 'x' };
		expect(idFor('ev', anchor)).toBe(idFor('ev', anchor));
	});

	it('differs for a different sentence', () => {
		const a = { file: 'ch05.md', snippet: '李慕白倒下了。', snippetHash: 'x' };
		const b = { file: 'ch05.md', snippet: '李慕白站起来了。', snippetHash: 'x' };
		expect(idFor('ev', a)).not.toBe(idFor('ev', b));
	});

	it('suffixes rather than colliding when the id is taken', () => {
		const anchor = { file: 'ch05.md', snippet: '李慕白倒下了。', snippetHash: 'x' };
		const first = idFor('ev', anchor);
		expect(idFor('ev', anchor, new Set([first]))).toBe(`${first}-2`);
	});
});

describe('chapterNumberOf', () => {
	it('prefers frontmatter', () => {
		expect(chapterNumberOf('anything.md', CHAPTER)).toBe(5);
	});

	it('falls back to the file name for an imported manuscript', () => {
		expect(chapterNumberOf('ch05.md', '正文')).toBe(5);
		expect(chapterNumberOf('第012章-风雪.md', '正文')).toBe(12);
	});

	// A leading volume number must not win over the chapter's own.
	it('takes the last run of digits', () => {
		expect(chapterNumberOf('vol2-ch18.md', '正文')).toBe(18);
	});

	it('returns undefined when there is no number anywhere', () => {
		expect(chapterNumberOf('序章.md', '正文')).toBeUndefined();
	});
});
