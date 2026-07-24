/*---------------------------------------------------------------------------------------------
 *  VS Novel — editing one line of Chinese prose actually works.
 *--------------------------------------------------------------------------------------------*/

/**
 * The matcher every targeted edit goes through.
 *
 * `replace_string_in_file`, `apply_patch`, `insert_edit` and the healing path all
 * reach `findAndReplaceOne`: it takes the passage the model says it is replacing
 * and locates it in the file. Everything about a manuscript that differs from
 * source code lands here — full-width punctuation, no spaces between words,
 * lines that are whole paragraphs rather than statements.
 *
 * It is upstream code and these are upstream's guarantees; the point of testing
 * them here is that nothing upstream tests them on this input, so a change that
 * quietly breaks Chinese would look green all the way to an author whose edit
 * silently landed in the wrong paragraph.
 */

import { describe, expect, it } from 'vitest';
import { findAndReplaceOne } from '../../../extension/tools/node/editFileToolUtils';

const CHAPTER = [
	'# 第三章 · 夜奔',
	'',
	'他没有回头。',
	'',
	'城门在身后合上，声音很闷，像是从水里传来的。她站在原地，等那声音散尽，才发现自己一直屏着气。',
	'',
	'「你真的要走？」',
	'',
	'「我已经走了。」',
].join('\n');

/**
 * The result carries which strategy matched, not a boolean. `exact` is the one
 * to insist on: the fallbacks — whitespace-flexible, fuzzy, similarity — are
 * where an edit lands somewhere plausible but wrong, and prose gives them far
 * more to work with than code does.
 */
function replaced(oldStr: string, newStr: string) {
	return findAndReplaceOne(CHAPTER, oldStr, newStr, '\n');
}

describe('replacing one line of a chapter', () => {

	it('finds a short sentence and replaces exactly it', () => {
		const result = replaced('他没有回头。', '他终究还是回了头。');
		expect(result.type).toBe('exact');
		expect(result.text).toContain('他终究还是回了头。');
		expect(result.text).not.toContain('他没有回头。');
	});

	// A paragraph is one line here, which is the shape prose has and code does not.
	it('replaces a whole paragraph', () => {
		const result = replaced(
			'城门在身后合上，声音很闷，像是从水里传来的。',
			'城门在身后合上，闷得像是隔着一层水。',
		);
		expect(result.type).toBe('exact');
		expect(result.text).toContain('闷得像是隔着一层水。');
		// The rest of that paragraph has to survive — a matcher that took the
		// whole line would swallow it.
		expect(result.text).toContain('她站在原地');
	});

	it('replaces a line of dialogue, corner brackets and all', () => {
		const result = replaced('「你真的要走？」', '「你当真要走？」');
		expect(result.type).toBe('exact');
		expect(result.text).toContain('「你当真要走？」');
	});

	it('edits a heading without touching the prose under it', () => {
		const result = replaced('# 第三章 · 夜奔', '# 第三章 · 出奔');
		expect(result.type).toBe('exact');
		expect(result.text).toContain('# 第三章 · 出奔');
		expect(result.text).toContain('他没有回头。');
	});

	// The failure that would be worst: an edit that lands somewhere plausible but
	// wrong. Two lines here differ only in their middle.
	it('does not confuse two similar lines of dialogue', () => {
		const result = replaced('「我已经走了。」', '「我早就走了。」');
		expect(result.type).toBe('exact');
		expect(result.text).toContain('「你真的要走？」');
		expect(result.text).toContain('「我早就走了。」');
	});

	it('reports a passage that is not there rather than picking one', () => {
		expect(replaced('他回头看了一眼。', '任何东西').type).toBe('none');
	});
});
