/*---------------------------------------------------------------------------------------------
 *  VS Novel — the classification a chapter actually goes through.
 *--------------------------------------------------------------------------------------------*/

/**
 * textEncoding.spec.ts checks the detector. This checks the decision it feeds:
 * `hexdumpIfBinary` is the single gate deciding whether a file reaches the model
 * as prose or as a hex dump, and both the read-file tool and file attachments
 * route through it.
 */

import { describe, expect, it } from 'vitest';
import type { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { hexdumpIfBinary } from '../../../extension/prompts/node/panel/binaryFileHexdump';
import { URI } from '../../../util/vs/base/common/uri';

/**
 * A file service that answers with exact bytes.
 *
 * The shared MockFileSystemService stores file contents as strings and encodes
 * them on read, which cannot express a UTF-16 file — the encoding is the whole
 * subject here.
 */
function fileServiceReturning(bytes: Uint8Array): IFileSystemService {
	return { readFile: async () => bytes } as Pick<IFileSystemService, 'readFile'> as IFileSystemService;
}

function utf16le(text: string): Uint8Array {
	const bytes = [0xFF, 0xFE];
	for (const unit of text) {
		const code = unit.charCodeAt(0);
		bytes.push(code & 0xFF, code >> 8);
	}
	return new Uint8Array(bytes);
}

const CHAPTER = URI.file('/book/第三章.txt');

describe('hexdumpIfBinary', () => {

	// The bug: a chapter saved by Windows Notepad as "Unicode" came back as a hex
	// dump, so asking anything about it got an answer about bytes.
	it('treats a utf-16 chapter as text', async () => {
		const service = fileServiceReturning(utf16le('第三章　夜奔\n他没有回头。'));
		expect(await hexdumpIfBinary(service, CHAPTER)).toBeUndefined();
	});

	it('still treats a utf-8 chapter as text', async () => {
		const service = fileServiceReturning(new TextEncoder().encode('第三章　夜奔'));
		expect(await hexdumpIfBinary(service, CHAPTER)).toBeUndefined();
	});

	// Keyed on the byte-order mark rather than the extension, so this stays a hex
	// dump. An extension-based exemption would have handed these bytes to the
	// model as if they were prose.
	it('does not let a binary file pass by being named .txt', async () => {
		const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
		const result = await hexdumpIfBinary(fileServiceReturning(png), CHAPTER);
		expect(result?.data).toEqual(png);
	});

	it('leaves the known-binary extension list working', async () => {
		// A PDF trips no nul byte in its header, which is why it is listed by
		// extension upstream. That list must survive the change above it.
		const pdf = new TextEncoder().encode('%PDF-1.7\nsome text');
		const result = await hexdumpIfBinary(fileServiceReturning(pdf), URI.file('/book/notes.pdf'));
		expect(result?.data).toEqual(pdf);
	});
});
