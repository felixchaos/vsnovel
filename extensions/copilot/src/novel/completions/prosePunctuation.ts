/*---------------------------------------------------------------------------------------------
 *  VS Novel — what counts as "nothing but punctuation after the cursor".
 *--------------------------------------------------------------------------------------------*/

/**
 * Ghost text is suppressed when the cursor sits mid-line, unless everything after
 * it is closing punctuation — a suggestion that has to be threaded through
 * existing words is unreadable, but one that ends just before a closing brace is
 * fine.
 *
 * The upstream character classes are `) > } ] " ' \`` and `: { ; ,`, which is the
 * complete set for code and contains not one CJK character. Two ordinary
 * situations therefore never suggest:
 *
 *   他没有回头|。          the author typed the sentence, then went back to extend it
 *   「我没有回头|」        the closing quote of a line of dialogue
 *
 * In both, the cursor is mid-line by the letter of the rule and at the end of
 * the writing by any useful reading of it.
 *
 * The alternative in the audit — make the check always pass — is rejected: it
 * would put ghost text in the middle of arbitrary prose, which is the case the
 * check exists to prevent. Widening the character set keeps the rule and fixes
 * the alphabet it was written in.
 */

/**
 * Closing punctuation, CJK. Mirrors the upstream class one for one where an
 * equivalent exists.
 *
 *  - `）》」』】〉〕｝］` — closing brackets and quotes, the counterparts of `) > } ]`
 *  - `”’` — closing curly quotes, used for speech in horizontal Chinese
 *  - `。！？…‥、；：，` — terminators and separators, the counterparts of `: { ; ,`
 *
 * `“‘「『（《【` and the other openers are deliberately absent: text after the
 * cursor that opens something is text the author is still going to write into.
 */
export const PROSE_CLOSERS = '）》」』】〉〕｝］”’';
export const PROSE_TERMINATORS = '。！？…‥、；：，';

/**
 * Whether everything after the cursor is closing punctuation.
 *
 * Mirrors the upstream shape — any number of closers, then at most one
 * terminator — rather than accepting the two in any order, so that a cursor in
 * the middle of real text still suppresses the suggestion.
 */
const PROSE_TAIL = new RegExp(`^\\s*[${PROSE_CLOSERS}]*\\s*[${PROSE_TERMINATORS}]?\\s*[${PROSE_CLOSERS}]*\\s*$`);

export function isProseTailAfterCursor(textAfterCursor: string): boolean {
	return PROSE_TAIL.test(textAfterCursor.trim());
}
