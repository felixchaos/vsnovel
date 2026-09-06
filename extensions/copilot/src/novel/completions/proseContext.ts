/*---------------------------------------------------------------------------------------------
 *  VS Novel — what belongs in a prose completion prompt.
 *--------------------------------------------------------------------------------------------*/

import { isProseLanguage } from './proseSampling';

/**
 * Whether the recent-edits block belongs in the prompt.
 *
 * The completion prompt is assembled from context components and ends with the
 * text before the caret. `RecentEdits` sits immediately before that text and
 * contributes a diff of the files the author touched last — for a manuscript,
 * whole paragraphs of another chapter, followed by the line
 * "These are recently edited files. Do not suggest code that has been deleted."
 *
 * The model then continues the paragraph it can see rather than the line the
 * caret is on. Measured against the real service, same model and sampling, one
 * file — a character sheet whose last line is `样貌：身高158cm，`:
 *
 *   with the block     「你明知道我会来。」我松开怀表…    (3 of 3: the chapter's scene)
 *   without it         有些苍白的脸，眼尾微微下垂…          (3 of 3: the sheet's field)
 *
 * That is the whole failure. The block is not merely unhelpful here — it is
 * more recent, longer and more narrative than the file being written, so it
 * wins.
 *
 * Nothing is lost by dropping it. Edits to the current file within a hundred
 * lines of the caret are already filtered out upstream, and the rest of that
 * file is in the prefix verbatim; what remains is other files, in diff form,
 * with `+`/`-` markers and an English instruction about code. A diff is a
 * useful hint about a refactor in progress. It says nothing about how the next
 * sentence should go.
 *
 * Scoped to prose rather than removed outright: for code the block does the job
 * it was written for.
 */
export function recentEditsBelongInPrompt(languageId: string | undefined): boolean {
	return !isProseLanguage(languageId);
}
