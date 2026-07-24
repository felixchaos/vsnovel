/*---------------------------------------------------------------------------------------------
 *  VS Novel — sampling parameters for prose completion.
 *--------------------------------------------------------------------------------------------*/

/**
 * The inline completion pipeline sends no system message — it is a raw
 * prefix/suffix request (`openai/fetch.ts:358-368`). Nothing about it can be
 * steered by prompt edits, so everything that makes it behave like a code
 * completer lives in constants, and this file holds the prose alternatives.
 *
 * Code behaviour is left exactly as it was. Each function here is consulted
 * only for the languages an author actually writes in.
 */

/**
 * Languages a manuscript is written in.
 *
 * `plaintext` and `markdown` are the two the product cares about, and both are
 * disabled by default in `github.copilot.enable` — a deliberate upstream choice
 * for a coding tool, and the first thing an author would hit.
 */
const PROSE_LANGUAGES = new Set(['markdown', 'plaintext']);

export function isProseLanguage(languageId?: string): boolean {
	return languageId !== undefined && PROSE_LANGUAGES.has(languageId);
}

/**
 * Stop sequences for prose.
 *
 * A paragraph is to prose what a statement is to code: the unit a completion
 * should offer and stop at. `\n\n` is that boundary, so it is the stop.
 *
 * Upstream stops markdown at `\n\n\n`, which in a manuscript is a scene break —
 * the completion then runs to the end of the scene. Left with no stop at all it
 * runs until `max_tokens`, which is worse in a way that is easy to mistake for
 * generosity: eight paragraphs of ghost text cannot be read at a glance, so the
 * author cannot do the one thing the interaction asks of them, and it commits to
 * plot the author has not decided yet. Truncating at a token limit also produces
 * exactly the mid-sentence cut this once returned nothing to avoid.
 */
export function proseStops(): string[] {
	return ['\n\n'];
}

/**
 * Sampling temperature for prose.
 *
 * Upstream returns 0.0 whenever a single completion is requested
 * (`openai.ts:149-151`), which is the normal case. Temperature 0 is right for
 * code — there is usually one correct continuation — and wrong for fiction,
 * where it produces the flat, repetitive register that reads as "the AI writes
 * badly". It is also the reason two consecutive completions at the same cursor
 * come back identical.
 *
 * 0.8 keeps sentences coherent while leaving room for word choice. Above ~1.2
 * Chinese output starts losing grammatical cohesion, so this is not exposed as
 * a slider — and could not be for every model anyway, since Claude Opus 4.7 and
 * later reject `temperature` outright.
 */
export function proseTemperature(numShots: number): number {
	// Multiple samples are asked for when the author wants alternatives, so
	// spread them further apart than a single suggestion.
	return numShots > 1 ? 1.0 : 0.8;
}

/**
 * Output budget for a prose completion.
 *
 * A backstop, not the mechanism: `\n\n` is what ends a suggestion, and this only
 * catches a paragraph that runs unusually long. It is set just above a long
 * Chinese paragraph for that reason — high enough that the stop nearly always
 * fires first, low enough that a model ignoring the stop cannot bill a page.
 *
 * It was 1200, which is several paragraphs. Ghost text that long defeats its own
 * interaction: the author is meant to glance and accept or ignore, and cannot
 * read a page at a glance. It also decides plot they have not decided.
 */
export function proseMaxTokens(): number {
	return 200;
}
