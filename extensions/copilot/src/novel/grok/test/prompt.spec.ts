/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for the prompt content built from a chat request.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { MAX_EMBEDDED_BYTES_PER_FILE, buildPromptBlocks } from '../prompt';

describe('buildPromptBlocks', () => {

	it('sends the author\'s words first and the material after', () => {
		const { blocks } = buildPromptBlocks('这一章怎么改', [
			{ uri: 'file:///book/world.md', name: 'world.md', text: '雪原上没有城。' },
		]);
		expect(blocks).toEqual([
			{ type: 'text', text: '这一章怎么改' },
			{ type: 'resource', resource: { uri: 'file:///book/world.md', mimeType: undefined, text: '雪原上没有城。' } },
		]);
	});

	it('embeds attachments rather than linking them', () => {
		// The whole bug this module exists for: an attachment that reaches the
		// agent only as a uri costs it a tool call and a permission prompt to
		// read, and an author who declines that prompt has attached nothing.
		const { blocks, degraded } = buildPromptBlocks('', [
			{ uri: 'file:///a.md', name: 'a.md', text: 'x' },
		]);
		expect(blocks[1].type).toBe('resource');
		expect(degraded).toEqual([]);
	});

	it('falls back to a link, and says so, for something too large to embed', () => {
		const huge = 'あ'.repeat(MAX_EMBEDDED_BYTES_PER_FILE); // 3 bytes each
		const { blocks, degraded } = buildPromptBlocks('', [
			{ uri: 'file:///whole-book.txt', name: 'whole-book.txt', text: huge },
		]);
		expect(blocks[1]).toEqual({ type: 'resource_link', uri: 'file:///whole-book.txt', name: 'whole-book.txt' });
		expect(degraded).toEqual([{ name: 'whole-book.txt', reason: 'too-large' }]);
	});

	it('measures the cap in bytes, not in characters', () => {
		// A CJK manuscript is three bytes per character. Counting UTF-16 units
		// would let three times the intended payload through, and the turn that
		// pays for it is the *next* one.
		const justUnder = 'あ'.repeat(Math.floor(MAX_EMBEDDED_BYTES_PER_FILE / 3) - 1);
		const justOver = 'あ'.repeat(Math.floor(MAX_EMBEDDED_BYTES_PER_FILE / 3) + 1);
		expect(buildPromptBlocks('', [{ uri: 'file:///a', name: 'a', text: justUnder }]).degraded).toEqual([]);
		expect(buildPromptBlocks('', [{ uri: 'file:///b', name: 'b', text: justOver }]).degraded).toHaveLength(1);
	});

	it('reports an attachment it could not read instead of dropping it', () => {
		const { blocks, degraded } = buildPromptBlocks('', [
			{ uri: 'file:///cover.png', name: 'cover.png' },
		]);
		expect(blocks[1].type).toBe('resource_link');
		expect(degraded).toEqual([{ name: 'cover.png', reason: 'unreadable' }]);
	});

	it('does not pay twice for a file attached twice', () => {
		const { blocks } = buildPromptBlocks('', [
			{ uri: 'file:///a.md', name: 'a.md', text: 'once' },
			{ uri: 'file:///a.md', name: 'a.md', text: 'once' },
		]);
		expect(blocks).toHaveLength(2);
	});

	it('keeps a selection and its whole file apart', () => {
		// They are different attachments. Collapsing them onto one uri keeps
		// whichever arrived last, which is the one the author did not pick.
		const { blocks } = buildPromptBlocks('', [
			{ uri: 'file:///ch1.md', name: 'ch1.md', text: 'whole chapter' },
			{ uri: 'file:///ch1.md', name: 'ch1.md', text: 'one line', range: { startLine: 4, endLine: 4 } },
		]);
		expect(blocks).toHaveLength(3);
		expect(blocks[2]).toMatchObject({ resource: { uri: 'file:///ch1.md#L4-L4', text: 'one line' } });
	});
});
