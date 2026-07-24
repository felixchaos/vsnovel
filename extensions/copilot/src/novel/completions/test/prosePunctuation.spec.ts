/*---------------------------------------------------------------------------------------------
 *  VS Novel — ghost text triggers where an author actually writes.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { isInlineSuggestionFromTextAfterCursor } from '../../../extension/xtab/common/inlineSuggestion';
import { isProseTailAfterCursor } from '../prosePunctuation';

/**
 * `undefined` means suppressed, `true` means allowed. Written through the
 * upstream entry point rather than the helper, because the helper being right
 * would not matter if the decision it feeds ignored it.
 */
function suggestsWith(textAfterCursor: string): boolean {
	return isInlineSuggestionFromTextAfterCursor(textAfterCursor) === true;
}

describe('prose tail', () => {

	// The two cases the audit named. Both are the ordinary shape of writing:
	// finishing a sentence, then going back to expand it.
	it('allows a suggestion before a full-width terminator', () => {
		expect(suggestsWith('。')).toBe(true);
		expect(suggestsWith('，')).toBe(true);
		expect(suggestsWith('？')).toBe(true);
	});

	it('allows a suggestion before a closing quote of dialogue', () => {
		expect(suggestsWith('」')).toBe(true);
		expect(suggestsWith('』')).toBe(true);
		expect(suggestsWith('”')).toBe(true);
	});

	it('allows the combinations dialogue actually ends with', () => {
		expect(suggestsWith('。」')).toBe(true);
		expect(suggestsWith('」。')).toBe(true);
		expect(suggestsWith('！」')).toBe(true);
	});

	// The rule this widens rather than removes: a suggestion threaded into the
	// middle of a sentence is unreadable, and that is still suppressed.
	it('still suppresses a suggestion in the middle of a sentence', () => {
		expect(suggestsWith('他没有回头。')).toBe(false);
		expect(suggestsWith('，他没有回头')).toBe(false);
		expect(suggestsWith('の声が聞こえた。')).toBe(false);
	});

	// Openers are not closers: text after the cursor that opens something is text
	// the author has not written into yet.
	it('does not treat an opening bracket as a tail', () => {
		expect(isProseTailAfterCursor('「')).toBe(false);
		expect(isProseTailAfterCursor('（')).toBe(false);
	});

	// The upstream behaviour has to survive intact — this file is loaded for every
	// language, not only prose.
	it('leaves the code cases exactly as they were', () => {
		expect(suggestsWith(')')).toBe(true);
		expect(suggestsWith('});')).toBe(true);
		expect(suggestsWith('"')).toBe(true);
		expect(suggestsWith('foo)')).toBe(false);
	});

	// End of line was never the blocked case, and must not become one.
	it('leaves end of line alone', () => {
		expect(isInlineSuggestionFromTextAfterCursor('')).toBe(false);
		expect(isInlineSuggestionFromTextAfterCursor('   ')).toBe(false);
	});
});
