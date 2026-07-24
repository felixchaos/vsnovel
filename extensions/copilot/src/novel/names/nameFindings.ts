/*---------------------------------------------------------------------------------------------
 *  VS Novel — turning a name check into things worth telling the author.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decides which results of a name check are worth interrupting the author for.
 *
 * Split out from the editor glue so the judgement is testable without a running
 * window, and because the judgement is the hard part: a writing tool that
 * underlines too much is worse than one that underlines nothing. A red squiggle
 * in the middle of a paragraph pulls the author out of the sentence they are in,
 * and once that has happened a few times for no reason they stop trusting every
 * mark the tool makes — including the correct ones.
 *
 * Two rules follow from that, and both are enforced here rather than left to the
 * caller:
 *
 *  - Nothing is ever auto-applied. A finding carries an optional replacement,
 *    and offering it is the whole of the action; 那男人 might be sloppiness or
 *    might be the point of the scene, and only the author knows which.
 *  - Anything inferred rather than looked up stays out. Every finding below
 *    comes from a form the author registered themselves, so a false positive
 *    means their own data disagrees with their prose — which is exactly the
 *    thing worth telling them.
 */

import type { NameCheckResult } from './nameIndex';

export type FindingKind =
	/** An alias stood in for a name that never appears in this passage. */
	| 'aliasDrift'
	/** One surface form is registered to more than one character. */
	| 'ambiguous';

export interface NameFinding {
	readonly kind: FindingKind;
	readonly start: number;
	readonly end: number;
	/** The text as written. */
	readonly surface: string;
	/** Resolved character, when there is exactly one. */
	readonly characterId?: string;
	/** The name the manuscript should settle on, when known. */
	readonly canonical?: string;
	/**
	 * What the optional fix would insert.
	 *
	 * Absent when there is nothing safe to offer — an ambiguous form has no
	 * single right answer, and guessing one is how a fix corrupts a draft.
	 */
	readonly replaceWith?: string;
	/** Every other occurrence of the same problem, for a fix-all action. */
	readonly relatedRanges: readonly { readonly start: number; readonly end: number }[];
}

/**
 * Converts a check result into findings, in document order.
 *
 * Only the *first* occurrence of a drifted alias becomes a finding. Underlining
 * all twenty uses of 慕白 in a chapter turns the page yellow and says nothing
 * the first one did not; the rest travel along as `relatedRanges` so a fix-all
 * is still one action.
 */
export function findingsFrom(result: NameCheckResult): NameFinding[] {
	const findings: NameFinding[] = [];

	for (const drift of result.aliasDrift) {
		const [first, ...rest] = drift.mentions;
		if (!first) {
			continue;
		}
		findings.push({
			kind: 'aliasDrift',
			start: first.start,
			end: first.end,
			surface: first.surface,
			characterId: drift.characterId,
			canonical: drift.canonical,
			replaceWith: drift.canonical,
			relatedRanges: rest.map(m => ({ start: m.start, end: m.end })),
		});
	}

	for (const ambiguous of result.ambiguous) {
		// No offsets are carried for ambiguity: the point is that the *registration*
		// is wrong, and the author fixes it in the character files, not in the
		// prose. Reporting it against the first occurrence would send them to the
		// wrong file.
		findings.push({
			kind: 'ambiguous',
			start: -1,
			end: -1,
			surface: ambiguous.surface,
			relatedRanges: [],
		});
	}

	return findings.sort((a, b) => a.start - b.start);
}

/** True when the finding points at a span in the document. */
export function isPositioned(finding: NameFinding): boolean {
	return finding.start >= 0 && finding.end > finding.start;
}
