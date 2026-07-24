/*---------------------------------------------------------------------------------------------
 *  VS Novel — telling a UTF-16 manuscript apart from a binary file.
 *--------------------------------------------------------------------------------------------*/

/**
 * The nul-byte heuristic that classifies files as binary is git's, and it is a
 * good one for source code: no UTF-8 text contains 0x00, so nothing legitimate
 * trips it. UTF-16 breaks that assumption completely — every ASCII character is
 * stored as two bytes with one of them zero, so a chapter saved as UTF-16 is
 * nul-bytes throughout and is classified as binary on its first line.
 *
 * This is not an edge case for this product. It is what Windows Notepad's
 * "Unicode" option writes, and the audience is authors on Windows. The symptom
 * is that asking about a chapter returns a hex dump of it.
 *
 * Detection is by byte-order mark only, deliberately. Encoding sniffing without
 * a BOM means guessing from byte statistics, and a wrong guess in this direction
 * hands a genuinely binary file to the model as text. Every editor that writes
 * UTF-16 writes the mark, so the guessing buys nothing and risks the case the
 * heuristic exists to catch.
 */

/**
 * Whether the data opens with a UTF-16 byte-order mark.
 *
 * A caller that gets `true` should treat the file as text and let the normal
 * text path read it: VS Code's own document service decodes the mark, so the
 * bytes only look binary to code that reads them raw.
 */
export function hasUtf16ByteOrderMark(data: Uint8Array): boolean {
	if (data.length < 2) {
		return false;
	}

	// UTF-32LE opens FF FE 00 00, which is the UTF-16LE mark followed by two
	// more zeros. Reporting it as UTF-16 would be wrong, and it is also not a
	// case worth claiming to handle — nothing in this stack reads UTF-32.
	if (data[0] === 0xFF && data[1] === 0xFE) {
		return !(data.length >= 4 && data[2] === 0x00 && data[3] === 0x00);
	}

	return data[0] === 0xFE && data[1] === 0xFF;
}
