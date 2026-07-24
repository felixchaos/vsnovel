/*---------------------------------------------------------------------------------------------
 *  VS Novel — the glossary of pinned translations.
 *--------------------------------------------------------------------------------------------*/

/**
 * A term whose rendering the author has decided.
 *
 * The point of the type is the asymmetry between its two halves. `source` and
 * `target` are a decision — Mulelia is 穆蕾莉亚 and nothing else. `variants` are
 * observations — spellings that have appeared and are known to mean the same
 * term. Nothing is ever inferred into `variants`: a mis-transliteration and a
 * deliberate alternative name look identical in the text, and guessing between
 * them silently rewrites the author's work.
 */
export interface GlossaryTerm {
	/** The term in the source language. Also the most reliable thing to find. */
	readonly source: string;
	/** The single sanctioned rendering. */
	readonly target: string;
	/**
	 * Renderings the author has declared wrong for this term.
	 *
	 * Declared, never inferred. A character deliberately called something else
	 * by a different narrator is a real and common device — see the address
	 * relation table in names/nameIndex.ts — and it is indistinguishable from an
	 * error without the author saying which it is.
	 */
	readonly variants?: readonly string[];
	/** Why this rendering was chosen. Shown with the diagnostic. */
	readonly note?: string;
}

export interface Glossary {
	readonly terms: readonly GlossaryTerm[];
}

export interface GlossaryProblem {
	readonly term: string;
	readonly message: string;
}

/**
 * Checks a glossary for entries that cannot mean what they say.
 *
 * Run at load rather than at use. A contradictory glossary applied to a
 * manuscript produces edits that fight each other, and the author would see the
 * damage rather than the cause.
 */
export function validateGlossary(glossary: Glossary): GlossaryProblem[] {
	const problems: GlossaryProblem[] = [];
	const targetsBySource = new Map<string, string>();
	const sourcesByTarget = new Map<string, string>();

	for (const term of glossary.terms) {
		if (!term.source.trim() || !term.target.trim()) {
			problems.push({ term: term.source || term.target, message: 'a term needs both a source and a target' });
			continue;
		}

		// The same source pinned twice, differently. Whichever ran last would win,
		// which is not a decision anyone made.
		const pinned = targetsBySource.get(term.source);
		if (pinned !== undefined && pinned !== term.target) {
			problems.push({ term: term.source, message: `pinned to both "${pinned}" and "${term.target}"` });
		}
		targetsBySource.set(term.source, term.target);

		// Two sources pinned to one target. Legitimate — two names can render the
		// same way — but worth saying, because it is more often a copy-paste.
		const collision = sourcesByTarget.get(term.target);
		if (collision !== undefined && collision !== term.source) {
			problems.push({ term: term.source, message: `renders to "${term.target}", the same as "${collision}"` });
		}
		sourcesByTarget.set(term.target, term.source);

		for (const variant of term.variants ?? []) {
			// A variant equal to the target would make enforcement replace the
			// correct rendering with itself, forever.
			if (variant === term.target) {
				problems.push({ term: term.source, message: `lists its own target "${variant}" as a wrong rendering` });
			} else if (term.target.includes(variant)) {
				// The correct rendering contains the wrong one, so every correct
				// occurrence looks like a violation. Enforcement refuses to touch a
				// span already holding a target, so nothing is corrupted — but the
				// entry can never match anything either, and saying so beats leaving
				// the author to wonder why their glossary does nothing.
				problems.push({ term: term.source, message: `"${variant}" is part of "${term.target}", so it can never be found on its own` });
			}
		}
	}

	// A variant of one term that is the target of another. Replacing it would
	// corrupt the other term rather than fix this one.
	const allTargets = new Set(glossary.terms.map(t => t.target));
	for (const term of glossary.terms) {
		for (const variant of term.variants ?? []) {
			if (variant !== term.target && allTargets.has(variant)) {
				problems.push({ term: term.source, message: `lists "${variant}" as wrong, but it is the pinned rendering of another term` });
			}
		}
	}

	return problems;
}

/*
 * A `renderGlossaryForPrompt` used to live here, building a prompt fragment out
 * of the pinned terms. It was removed rather than left unused: nothing called
 * it, and under the tool model nothing should. The agent reads
 * `.novel/glossary/` the way it reads any other file, and an author who wants
 * the terms stated in every request already has `.github/copilot-instructions.md`
 * — which does exactly that, natively, with no code of ours in the path.
 *
 * The tree-shaker is what surfaced it: the string never reached the bundle,
 * because there was no caller.
 */
