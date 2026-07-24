/*---------------------------------------------------------------------------------------------
 *  VS Novel — retrieval spine tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { chunk } from '../../index/chunker';
import { InvertedIndex } from '../../index/invertedIndex';
import { fuse, RRF_K } from '../../index/rrf';
import { byRelevanceThenEarliest, twoStageRank } from '../rank';
import { allowed, revealGate } from '../revealGate';

describe('InvertedIndex', () => {
	const index = new InvertedIndex();
	index.add({ id: 'c1', text: '玄冥子站在山门前，风雪压境。' });
	index.add({ id: 'c2', text: '林轩看着山门，想起了师父。' });
	index.add({ id: 'c3', text: '玄冥子闭关三十年，无人得见。' });

	// The reason the lexical route is first-class: an invented name is exactly
	// what an embedding cannot find.
	it('recalls an invented proper noun exactly', () => {
		expect(index.search('玄冥子').map(h => h.chunkId).sort()).toEqual(['c1', 'c3']);
	});

	it('explains a hit with the tokens that matched', () => {
		expect(index.search('玄冥子')[0].matched.length).toBeGreaterThan(0);
	});

	// A token in every chunk carries no information, and letting it score would
	// bury the one distinctive token in the same query.
	it('weights a rare token above a common one', () => {
		const common = new InvertedIndex();
		for (let i = 0; i < 10; i++) {
			common.add({ id: `c${i}`, text: '他说了一句话。' });
		}
		common.add({ id: 'rare', text: '他说了一句话。玄冥子出现了。' });
		expect(common.search('他说 玄冥子')[0].chunkId).toBe('rare');
	});

	it('replaces a chunk on re-add rather than double-counting', () => {
		const ix = new InvertedIndex();
		ix.add({ id: 'c1', text: '玄冥子' });
		ix.add({ id: 'c1', text: '林轩' });
		expect(ix.search('玄冥子')).toEqual([]);
		expect(ix.search('林轩').map(h => h.chunkId)).toEqual(['c1']);
		expect(ix.size).toBe(1);
	});

	it('forgets a removed chunk', () => {
		const ix = new InvertedIndex();
		ix.add({ id: 'c1', text: '玄冥子' });
		ix.remove('c1');
		expect(ix.search('玄冥子')).toEqual([]);
		expect(ix.size).toBe(0);
	});

	it('returns a stable order, so a cached prompt cannot differ between turns', () => {
		expect(index.search('山门')).toEqual(index.search('山门'));
	});

	it('returns nothing rather than everything for an unknown query', () => {
		expect(index.search('从未出现的词')).toEqual([]);
	});
});

describe('fuse', () => {
	// The property that makes fusion worth doing: agreement across routes beats a
	// strong showing on one. (Note it is agreement, not average rank — because
	// 1/x is convex, ranks 1+3 actually sum slightly above 2+2.)
	it('rewards a chunk both routes found over one only a single route found', () => {
		const got = fuse([
			{ source: 'lexical', ids: ['lexOnly', 'both'] },
			{ source: 'vector', ids: ['vecOnly', 'both'] },
		]);
		expect(got[0].chunkId).toBe('both');
	});

	it('scores by rank, not by the routes original numbers', () => {
		const got = fuse([{ source: 'lexical', ids: ['a'] }]);
		expect(got[0].score).toBeCloseTo(1 / (RRF_K + 1));
	});

	it('records which routes contributed, for explaining the result', () => {
		const got = fuse([
			{ source: 'lexical', ids: ['a'] },
			{ source: 'vector', ids: ['a'] },
		]);
		expect(got[0].ranks).toEqual([{ source: 'lexical', rank: 1 }, { source: 'vector', rank: 1 }]);
	});

	// An empty list means "this route returned nothing", which for an unreachable
	// embedding endpoint must not push anything down. This is what makes the
	// offline case degrade to lexical-only instead of to nothing.
	it('degrades to the surviving route when another returns nothing', () => {
		const got = fuse([
			{ source: 'lexical', ids: ['a', 'b'] },
			{ source: 'vector', ids: [] },
		]);
		expect(got.map(h => h.chunkId)).toEqual(['a', 'b']);
	});

	it('honours a weight without switching a route off', () => {
		const strong = fuse([
			{ source: 'lexical', ids: ['a'], weight: 10 },
			{ source: 'vector', ids: ['b'] },
		]);
		expect(strong[0].chunkId).toBe('a');
		expect(strong.map(h => h.chunkId)).toContain('b');
	});
});

describe('revealGate', () => {
	const items = [
		{ id: 'early', firstRevealed: 3 },
		{ id: 'now', firstRevealed: 30 },
		{ id: 'future', firstRevealed: 200 },
		{ id: 'unplaced' },
	];

	// The failure this exists to prevent: writing chapter 30 and being told who a
	// character turns out to be in chapter 200.
	it('withholds anything revealed after the current chapter', () => {
		const got = revealGate(items, { currentChapter: 30 });
		expect(got.allowed.map(i => i.id)).toEqual(['early', 'now']);
		expect(got.withheld.map(w => [w.item.id, w.reason])).toEqual([
			['future', 'future'], ['unplaced', 'unplaced'],
		]);
	});

	// "NULL tightens." A passage with no recorded reveal point might be from the
	// last chapter, and admitting it because nobody said otherwise is the leak.
	it('fails closed on unknown position', () => {
		const noRevealPoint: { id: string; firstRevealed?: number }[] = [{ id: 'x' }];
		expect(allowed(noRevealPoint, { currentChapter: 999 }).map(i => i.id)).toEqual([]);
	});

	it('withholds everything when the author position is unknown', () => {
		expect(allowed(items).map(i => i.id)).toEqual([]);
	});

	it('lets unplaced material through only when explicitly asked', () => {
		expect(allowed(items, { currentChapter: 30, allowUnplaced: true }).map(i => i.id))
			.toEqual(['early', 'now', 'unplaced']);
	});

	// A gate that silently removes results is indistinguishable from a retrieval
	// bug, and an author who cannot tell will stop trusting the answers.
	it('reports what it withheld rather than dropping it silently', () => {
		expect(revealGate(items, { currentChapter: 30 }).withheld).toHaveLength(2);
	});
});

describe('twoStageRank', () => {
	// Without the second stage a chapter-800 passage sits above a chapter-3 one
	// and a model reading top-down takes the order as chronology.
	it('selects by relevance but presents in story order', () => {
		const got = twoStageRank([
			{ chunkId: 'late', score: 9, chapter: 800 },
			{ chunkId: 'early', score: 5, chapter: 3 },
		]);
		expect(got.map(r => r.chunkId)).toEqual(['early', 'late']);
	});

	it('still lets relevance decide what is included', () => {
		const got = twoStageRank([
			{ chunkId: 'irrelevant-early', score: 1, chapter: 1 },
			{ chunkId: 'relevant-late', score: 9, chapter: 800 },
		], { limit: 1 });
		expect(got.map(r => r.chunkId)).toEqual(['relevant-late']);
	});

	// The real incident: 宴会 scored identically in chapters 52…1310, a
	// descending sort picked the finale, and an early reader's context was
	// anchored to the ending.
	it('breaks a tie toward the earlier chapter', () => {
		const got = twoStageRank([
			{ chunkId: 'finale', score: 1, chapter: 1310 },
			{ chunkId: 'mid', score: 1, chapter: 152 },
			{ chunkId: 'first', score: 1, chapter: 52 },
		], { limit: 1 });
		expect(got.map(r => r.chunkId)).toEqual(['first']);
	});

	// Presentation order cannot undo a bad top-K cut, so the tie-break has to be
	// in the selection comparator too.
	it('applies the tie-break during selection, not only presentation', () => {
		const sorted = [
			{ chunkId: 'finale', score: 1, chapter: 1310 },
			{ chunkId: 'first', score: 1, chapter: 52 },
		].sort(byRelevanceThenEarliest);
		expect(sorted[0].chunkId).toBe('first');
	});

	it('applies a chapter bound as a second line behind the gate', () => {
		const got = twoStageRank([
			{ chunkId: 'future', score: 9, chapter: 800 },
			{ chunkId: 'now', score: 1, chapter: 20 },
		], { maxChapter: 30 });
		expect(got.map(r => r.chunkId)).toEqual(['now']);
	});

	it('sorts a chapterless passage last rather than first', () => {
		const got = twoStageRank([
			{ chunkId: 'unplaced', score: 9 },
			{ chunkId: 'placed', score: 1, chapter: 5 },
		]);
		expect(got.map(r => r.chunkId)).toEqual(['placed', 'unplaced']);
	});
});

describe('chunk', () => {
	it('does not cut a sentence in half', () => {
		const text = '第一句话在这里。'.repeat(30);
		for (const piece of chunk(text, { targetSize: 100 })) {
			expect(piece.text.endsWith('。')).toBe(true);
		}
	});

	// A splitter that only knows "." produces one chunk per chapter for most of
	// this corpus — a bug that looks like "retrieval returns whole chapters".
	it('splits on full-width terminators', () => {
		expect(chunk('甲。'.repeat(200), { targetSize: 100 }).length).toBeGreaterThan(1);
	});

	it('prefers a paragraph break when there is one', () => {
		const text = `${'甲'.repeat(80)}。\n\n${'乙'.repeat(80)}。`;
		const pieces = chunk(text, { targetSize: 100 });
		expect(pieces[0].text.includes('乙')).toBe(false);
	});

	it('skips frontmatter so a chapter does not match its own field names', () => {
		const pieces = chunk('---\nchapter: 5\npov: zhang\n---\n正文开始了。', { targetSize: 100 });
		expect(pieces.map(p => p.text).join('')).not.toContain('chapter');
	});

	it('reports offsets that slice back to the chunk', () => {
		const text = '---\nchapter: 5\n---\n第一句。第二句。';
		for (const piece of chunk(text, { targetSize: 10 })) {
			expect(text.slice(piece.start, piece.end)).toBe(piece.text);
		}
	});

	// Overlap exists so a fact stated across a boundary is retrievable from
	// either side.
	it('overlaps neighbouring chunks', () => {
		const pieces = chunk('甲乙丙丁。'.repeat(60), { targetSize: 100, overlap: 30 });
		expect(pieces.length).toBeGreaterThan(1);
		expect(pieces[1].start).toBeLessThan(pieces[0].end);
	});

	// An imported draft with no punctuation for thousands of characters must not
	// hang the indexer.
	it('terminates on text with no punctuation at all', () => {
		const pieces = chunk('甲'.repeat(5000), { targetSize: 200 });
		expect(pieces.length).toBeGreaterThan(1);
		expect(pieces.every(p => p.text.length > 0)).toBe(true);
	});

	it('returns nothing for an empty body', () => {
		expect(chunk('---\nchapter: 5\n---\n   ')).toEqual([]);
	});

	it('carries the chapter through for the gate and the ranker', () => {
		expect(chunk('正文。', { chapter: 7 })[0].chapter).toBe(7);
	});
});

describe('the spine end to end', () => {
	// Lexical recall → fusion → gate → two-stage ranking, which is the order a
	// real query runs in.
	it('finds a name, withholds the future, and presents in story order', () => {
		const chapters = [
			{ chapter: 3, text: '玄冥子第一次出现在山门前。' },
			{ chapter: 30, text: '玄冥子闭关的消息传来。' },
			{ chapter: 200, text: '玄冥子其实是林轩的父亲。' },
		];

		const index = new InvertedIndex();
		const meta = new Map<string, { chapter: number; firstRevealed: number }>();
		for (const { chapter, text } of chapters) {
			for (const piece of chunk(text, { chapter, idPrefix: `ch${chapter}` })) {
				index.add({ id: piece.id, text: piece.text });
				meta.set(piece.id, { chapter, firstRevealed: chapter });
			}
		}

		const hits = index.search('玄冥子');
		const fused = fuse([{ source: 'lexical', ids: hits.map(h => h.chunkId) }]);
		const gated = allowed(
			fused.map(h => ({ ...h, ...meta.get(h.chunkId)! })),
			{ currentChapter: 30 },
		);
		const ranked = twoStageRank(gated);

		expect(ranked.map(r => r.chapter)).toEqual([3, 30]);
		// The chapter-200 reveal never reaches the prompt.
		expect(ranked.some(r => r.chapter === 200)).toBe(false);
	});
});
