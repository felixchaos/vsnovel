/*---------------------------------------------------------------------------------------------
 *  VS Novel — the hard half of a pinned translation.
 *--------------------------------------------------------------------------------------------*/

/**
 * A prompt instruction is a request. This is not.
 *
 * The glossary is injected into the prompt so the model usually gets a name
 * right, and enforced here so that "usually" is not what the author ships. The
 * pattern is inherited deliberately: the extraction pipeline this product draws
 * from pins a constant in the prompt *and* overwrites the field after the model
 * answers, on the principle that what the model said is not evidence about what
 * the author decided.
 *
 * The two entry points below are not a convenience pair — the difference between
 * them is the whole design:
 *
 *  - {@link enforceGlossary} rewrites. Used on what the model produced, where a
 *    wrong rendering is a defect and the author never asked for it.
 *  - {@link findGlossaryViolations} only reports. Used on the manuscript, where
 *    a wrong rendering might be the author writing something on purpose.
 *
 * Silently rewriting an author's own prose to match a table would be the worst
 * failure this module could have, so the rewriting function is never pointed at
 * it.
 */

import { hasCJK } from '../index/cjkTokenizer';
import { boundedOccurrences } from '../index/wordBoundary';
import { Glossary, GlossaryTerm } from './glossary';

export interface GlossaryViolation {
	readonly term: GlossaryTerm;
	/** The text as it was written. */
	readonly found: string;
	readonly start: number;
	readonly end: number;
	/**
	 * `variant` — a rendering the author declared wrong for this term.
	 * `untranslated` — the source term itself, left in the translated text.
	 */
	readonly kind: 'variant' | 'untranslated';
}

export interface EnforcementResult {
	readonly text: string;
	/** What was replaced, in the order it appeared. */
	readonly applied: readonly GlossaryViolation[];
}

/**
 * Every place the text renders a pinned term some other way.
 *
 * Reports rather than changes anything, so the same function serves the
 * diagnostic on the manuscript and the rewrite of model output.
 */
export function findGlossaryViolations(text: string, glossary: Glossary): GlossaryViolation[] {
	const found: GlossaryViolation[] = [];

	// Spans already holding a correct rendering. A variant can be a substring of
	// the very target it is wrong for — "穆蕾" against 穆蕾莉亚 — and without
	// this the correct text is the thing that gets rewritten.
	const protectedSpans = glossary.terms.flatMap(term => occurrences(text, term.target));

	for (const term of glossary.terms) {
		const candidates: { pattern: string; kind: GlossaryViolation['kind'] }[] = [
			...(term.variants ?? []).map(pattern => ({ pattern, kind: 'variant' as const })),
			{ pattern: term.source, kind: 'untranslated' as const },
		];

		for (const { pattern, kind } of candidates) {
			if (!pattern || pattern === term.target) {
				continue;
			}
			for (const [start, end] of occurrences(text, pattern)) {
				if (protectedSpans.some(([s, e]) => start < e && s < end)) {
					continue;
				}
				found.push({ term, found: text.slice(start, end), start, end, kind });
			}
		}
	}

	return resolveOverlaps(found);
}

/**
 * Replaces every wrong rendering with the pinned one.
 *
 * For model output only — see the note at the top of this file.
 */
export function enforceGlossary(text: string, glossary: Glossary): EnforcementResult {
	const applied = findGlossaryViolations(text, glossary);

	// Right to left, so each replacement leaves the offsets of the ones still to
	// come untouched.
	let out = text;
	for (const violation of [...applied].reverse()) {
		out = out.slice(0, violation.start) + violation.term.target + out.slice(violation.end);
	}

	return { text: out, applied };
}

/**
 * Where `pattern` occurs, as `[start, end)` pairs.
 *
 * Latin patterns need a word boundary and CJK patterns must not have one — the
 * two scripts disagree about what separates words, and applying either rule to
 * the other finds nothing or finds everything. Latin is matched case-folded so
 * "mulelia" at the start of a sentence is still the same name.
 */
function occurrences(text: string, pattern: string): [number, number][] {
	if (!pattern) {
		return [];
	}
	if (hasCJK(pattern)) {
		const spans: [number, number][] = [];
		for (let from = 0; ;) {
			const at = text.indexOf(pattern, from);
			if (at === -1) {
				return spans;
			}
			spans.push([at, at + pattern.length]);
			from = at + 1;
		}
	}
	const folded = pattern.toLocaleLowerCase();
	return boundedOccurrences(text.toLocaleLowerCase(), folded).map(at => [at, at + folded.length]);
}

/**
 * Keeps the longest match where two overlap, and the earlier one where they are
 * the same length.
 *
 * Two terms can share a prefix — 穆蕾 and 穆蕾莉亚 — and applying both to one
 * span would replace part of a name and leave the rest, producing text that
 * matches nothing and reads as neither. Longest-wins matches how names are
 * resolved elsewhere in this product, so the two agree on which term a stretch
 * of text belongs to.
 */
function resolveOverlaps(violations: GlossaryViolation[]): GlossaryViolation[] {
	const byPosition = [...violations].sort((a, b) =>
		a.start - b.start || (b.end - b.start) - (a.end - a.start)
	);

	const kept: GlossaryViolation[] = [];
	let consumedTo = -1;
	for (const violation of byPosition) {
		if (violation.start < consumedTo) {
			continue;
		}
		kept.push(violation);
		consumedTo = violation.end;
	}
	return kept;
}
