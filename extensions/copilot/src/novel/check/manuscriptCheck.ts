/*---------------------------------------------------------------------------------------------
 *  VS Novel — running the checks, without an editor.
 *--------------------------------------------------------------------------------------------*/

/**
 * The agent's equivalent of running the test suite.
 *
 * The diagnostics contributions publish into the Problems panel, which is the
 * author's view: it follows their `novel.nameCheck` setting, it covers the files
 * they happen to have open, and its default mode publishes nothing at all so a
 * new manuscript is not covered in squiggles. All of that is right for a person
 * and wrong for an agent, which needs to check work it has just written in a
 * file nobody opened.
 *
 * So this re-runs the same pure checkers rather than reading what the panel
 * happens to hold. Same functions, no shared state, no dependency on the editor
 * — which is also what makes it testable without one.
 */

import { checkFacts, ConsistencyFinding } from '../consistency/factConsistency';
import type { Fact } from '../facts/fact';
import { Foreshadow, overdue } from '../foreshadow/foreshadow';
import { findGlossaryViolations } from '../glossary/enforce';
import type { Glossary } from '../glossary/glossary';
import type { Character } from '../names/nameIndex';
import { NameIndex } from '../names/nameIndex';
import { findingsFrom, isPositioned } from '../names/nameFindings';

export type CheckKind = 'name' | 'consistency' | 'foreshadow' | 'glossary';

export interface ManuscriptFinding {
	readonly kind: CheckKind;
	/**
	 * The chapter the finding is in, workspace-relative.
	 *
	 * Absent for findings about the work as a whole — a contradiction between two
	 * chapters belongs to neither of them, and filing it under one would send the
	 * agent to edit the half that is probably correct.
	 */
	readonly file?: string;
	/** Offset within that file, when the finding points at a span. */
	readonly start?: number;
	readonly end?: number;
	readonly message: string;
}

export interface CheckedFile {
	/** Workspace-relative, because that is what the finding has to say back. */
	readonly path: string;
	readonly text: string;
}

export interface CheckInputs {
	readonly characters?: readonly Character[];
	readonly facts?: readonly Fact[];
	readonly threads?: readonly Foreshadow[];
	readonly glossary?: Glossary;
}

/**
 * Runs every check that has the records to run.
 *
 * A missing record set skips its check rather than failing: an author who keeps
 * a glossary but no character files should still get glossary findings, and a
 * check that cannot run must not take the ones that can with it.
 */
export function checkManuscript(files: readonly CheckedFile[], inputs: CheckInputs): ManuscriptFinding[] {
	const findings: ManuscriptFinding[] = [];

	const nameIndex = inputs.characters?.length ? NameIndex.build(inputs.characters) : undefined;
	const glossary = inputs.glossary?.terms.length ? inputs.glossary : undefined;

	for (const file of files) {
		if (nameIndex) {
			for (const finding of findingsFrom(nameIndex.check(file.text))) {
				findings.push({
					kind: 'name',
					file: file.path,
					...(isPositioned(finding) ? { start: finding.start, end: finding.end } : {}),
					message: finding.kind === 'ambiguous'
						? `"${finding.surface}" could be more than one character; the manuscript does not settle it.`
						: `"${finding.surface}" stands in for ${finding.canonical ?? 'a name'} that never appears in this passage.`,
				});
			}
		}

		if (glossary) {
			for (const violation of findGlossaryViolations(file.text, glossary)) {
				findings.push({
					kind: 'glossary',
					file: file.path,
					start: violation.start,
					end: violation.end,
					message: violation.kind === 'untranslated'
						? `"${violation.term.source}" is pinned to "${violation.term.target}" and was left untranslated.`
						: `"${violation.found}" should be "${violation.term.target}".`,
				});
			}
		}
	}

	// Book-level. These read the records rather than the prose, so they are the
	// same answer whichever files were asked about — and the agent needs them
	// even when it asked about one chapter, because that is where a contradiction
	// it just introduced shows up.
	const facts = inputs.facts ?? [];
	const threads = inputs.threads ?? [];

	for (const finding of facts.length ? checkFacts(facts) : []) {
		findings.push({ kind: 'consistency', message: describeConsistency(finding) });
	}

	if (threads.length) {
		const position = Math.max(
			0,
			...facts.map(f => f.narrativeOrder),
			...threads.map(t => t.paidOffAt ?? t.plantedAt),
		);
		for (const late of overdue(threads, { position, facts })) {
			findings.push({
				kind: 'foreshadow',
				message: late.blockedBy.length === 0
					? `"${late.entry.title}" is overdue and nothing is blocking it.`
					: `"${late.entry.title}" is overdue, still waiting on ${late.blockedBy.length} condition(s).`,
			});
		}
	}

	return findings;
}

function describeConsistency(finding: ConsistencyFinding): string {
	const where = finding.priorFact
		? ` It contradicts what was recorded at ${finding.priorFact.narrativeOrder}.`
		: '';
	const detail = finding.detail ? ` ${finding.detail}` : '';
	return `${finding.subject}: ${finding.kind}.${detail}${where}`;
}
