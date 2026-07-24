/*---------------------------------------------------------------------------------------------
 *  VS Novel — where a word ends, in a manuscript that mixes scripts.
 *--------------------------------------------------------------------------------------------*/

/**
 * Every module that looks for a name in prose needs the same rule, and it is not
 * the obvious one.
 *
 * `\b` is defined over ASCII word characters, so it puts a boundary in the
 * middle of `Zoë` and `Mulélia` — exactly the names a fantasy manuscript is full
 * of. The rule that works is "not adjacent to a letter, digit or underscore",
 * with letter meaning any script's.
 *
 * The rule only applies to Latin terms. Chinese and Japanese are written without
 * separators, so requiring a boundary there would match nothing at all; those
 * are matched as substrings. Callers decide which they have — usually from
 * {@link hasCJK} — because the term is what determines it, not the text.
 */

export function isWordChar(ch: string): boolean {
	return ch !== '' && /[\p{L}\p{N}_]/u.test(ch);
}

/** Whether `[start, end)` in `text` is flanked by non-word characters. */
export function isWordBounded(text: string, start: number, end: number): boolean {
	const before = start === 0 ? '' : text[start - 1];
	const after = text[end] ?? '';
	return !isWordChar(before) && !isWordChar(after);
}

/**
 * The offsets at which `needle` occurs in `haystack` on a word boundary.
 *
 * Scans past a rejected hit by one character rather than by the needle's length:
 * overlapping occurrences are rare in prose but skipping them would be a silent
 * miss, and the cost is one comparison.
 */
export function boundedOccurrences(haystack: string, needle: string): number[] {
	const found: number[] = [];
	if (!needle) {
		return found;
	}
	for (let from = 0; ;) {
		const at = haystack.indexOf(needle, from);
		if (at === -1) {
			return found;
		}
		if (isWordBounded(haystack, at, at + needle.length)) {
			found.push(at);
		}
		from = at + 1;
	}
}
