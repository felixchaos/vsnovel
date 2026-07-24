/*---------------------------------------------------------------------------------------------
 *  VS Novel — UTF-16 manuscripts are not binary files.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { isBinaryContent } from '../../../util/common/hexdump';
import { hasUtf16ByteOrderMark } from '../textEncoding';

/** Encodes text the way Windows Notepad's "Unicode" option writes it. */
function utf16le(text: string, { bom = true } = {}): Uint8Array {
	const bytes: number[] = bom ? [0xFF, 0xFE] : [];
	for (const unit of text) {
		const code = unit.charCodeAt(0);
		bytes.push(code & 0xFF, code >> 8);
	}
	return new Uint8Array(bytes);
}

function utf16be(text: string): Uint8Array {
	const bytes: number[] = [0xFE, 0xFF];
	for (const unit of text) {
		const code = unit.charCodeAt(0);
		bytes.push(code >> 8, code & 0xFF);
	}
	return new Uint8Array(bytes);
}

const CHAPTER = '第三章　夜奔\n他没有回头。';

describe('utf-16 byte order mark', () => {

	// The premise. If this ever stops holding, the detection below is solving a
	// problem that no longer exists and should be removed rather than kept.
	it('is what the binary heuristic mistakes a manuscript for', () => {
		expect(isBinaryContent(utf16le(CHAPTER))).toBe(true);
		expect(isBinaryContent(utf16be(CHAPTER))).toBe(true);
		// The same chapter as UTF-8 has no nul bytes at all, which is why this
		// only ever shows up for authors whose editor writes UTF-16.
		expect(isBinaryContent(new TextEncoder().encode(CHAPTER))).toBe(false);
	});

	it('recognises both byte orders', () => {
		expect(hasUtf16ByteOrderMark(utf16le(CHAPTER))).toBe(true);
		expect(hasUtf16ByteOrderMark(utf16be(CHAPTER))).toBe(true);
	});

	it('leaves utf-8 alone, with or without its own mark', () => {
		expect(hasUtf16ByteOrderMark(new TextEncoder().encode(CHAPTER))).toBe(false);
		const utf8Bom = new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode(CHAPTER)]);
		expect(hasUtf16ByteOrderMark(utf8Bom)).toBe(false);
	});

	// The direction that matters: a wrong answer here sends a real binary file to
	// the model as text. Detection is by mark alone precisely so this stays true.
	it('does not claim binary content is text', () => {
		const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
		expect(hasUtf16ByteOrderMark(png)).toBe(false);

		const zip = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]);
		expect(hasUtf16ByteOrderMark(zip)).toBe(false);
	});

	// FF FE 00 00 is the UTF-32LE mark and only looks like UTF-16LE because it
	// starts with those two bytes. Nothing in this stack reads UTF-32, so
	// claiming it would promise a decode that does not happen.
	it('does not mistake utf-32 for utf-16', () => {
		expect(hasUtf16ByteOrderMark(new Uint8Array([0xFF, 0xFE, 0x00, 0x00, 0x41, 0x00]))).toBe(false);
	});

	// Without a mark there is nothing to key on but byte statistics, and guessing
	// wrong costs more than the case it would recover.
	it('makes no claim about unmarked utf-16', () => {
		expect(hasUtf16ByteOrderMark(utf16le(CHAPTER, { bom: false }))).toBe(false);
	});

	it('handles inputs too short to carry a mark', () => {
		expect(hasUtf16ByteOrderMark(new Uint8Array([]))).toBe(false);
		expect(hasUtf16ByteOrderMark(new Uint8Array([0xFF]))).toBe(false);
	});
});
