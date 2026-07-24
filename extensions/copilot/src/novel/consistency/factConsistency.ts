/*---------------------------------------------------------------------------------------------
 *  VS Novel — consistency over the fact record.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checks a manuscript's facts against each other.
 *
 * Everything here turns on one rule, and it is the rule the whole two-axis
 * design exists to make possible: **contradictions are judged on story time,
 * never on chapter order.** A character who died in chapter five appearing in
 * chapter eight is only a contradiction if chapter eight is set *later*. If it
 * is set earlier, it is a flashback, and reporting it would be the checker
 * telling the author their deliberate structure is a mistake.
 *
 * That failure mode is not hypothetical or minor. Flashbacks are ordinary in
 * this genre, and a checker that cries wolf on them is one an author turns off
 * within a day — taking the findings that were correct with it.
 *
 * Where story time is unknown, nothing is reported. An unplaced fact cannot be
 * shown to come after anything, and guessing that it does would manufacture
 * exactly the false positive above.
 */

import { byStoryTime, compareStoryTime, Fact } from '../facts/fact';
import { checkLifeTransition, LifeState, normalizeLifeState } from './lifeFsm';

/** The dimension the life FSM governs. */
export const LIFE_DIMENSION = 'life';

export type ConsistencyKind =
	/** A state moved out of a terminal one, in story-time order. */
	| 'illegalLifeTransition'
	/** A character does something at a story time after they died. */
	| 'deadCharacterActs'
	/** Two different values asserted for the same subject and dimension at one moment. */
	| 'contradictionAtSameTime'
	/** A state word the alias table does not recognise. */
	| 'unknownState';

export interface ConsistencyFinding {
	readonly kind: ConsistencyKind;
	readonly subject: string;
	/** The fact that raised the finding. */
	readonly fact: Fact;
	/** The earlier fact it contradicts, when there is one. */
	readonly priorFact?: Fact;
	readonly detail?: string;
}

export interface CheckFactsOptions {
	/**
	 * Ordering of named eras, earliest first.
	 *
	 * Without it, facts in different eras are simply not comparable and no
	 * cross-era finding is reported — see {@link compareStoryTime}.
	 */
	readonly eraOrder?: readonly string[];
}

/**
 * Runs every consistency rule over a fact set.
 *
 * Findings come back in story order so the author reads them the way the story
 * happens, which is the order in which one contradiction explains the next.
 */
export function checkFacts(facts: readonly Fact[], options: CheckFactsOptions = {}): ConsistencyFinding[] {
	const findings: ConsistencyFinding[] = [];
	const bySubject = new Map<string, Fact[]>();
	for (const fact of facts) {
		const bucket = bySubject.get(fact.subject);
		if (bucket) {
			bucket.push(fact);
		} else {
			bySubject.set(fact.subject, [fact]);
		}
	}

	for (const [subject, subjectFacts] of bySubject) {
		// Story order, not chapter order. This single choice is what makes a
		// flashback pass through every rule below untouched: a fact set earlier
		// sorts earlier, so it is never judged against a later state.
		const ordered = byStoryTime(subjectFacts, options.eraOrder);
		findings.push(...checkLife(subject, ordered, options));
		findings.push(...checkSimultaneousContradictions(subject, ordered, options));
	}

	return findings.sort((a, b) => {
		const order = compareStoryTime(a.fact.storyTime, b.fact.storyTime, options.eraOrder);
		return (order ?? 0) || a.fact.narrativeOrder - b.fact.narrativeOrder;
	});
}

/**
 * Life transitions, plus the derived rule that a dead character stops acting.
 *
 * The derived rule is the one the design calls for and the FSM alone cannot
 * express: the FSM sees only life-dimension facts, but a dead character showing
 * up as present somewhere is asserted on a *different* dimension. So death is
 * tracked here as a moment, and any later fact about the subject is measured
 * against it.
 */
function checkLife(subject: string, ordered: readonly Fact[], options: CheckFactsOptions): ConsistencyFinding[] {
	const findings: ConsistencyFinding[] = [];
	let state: LifeState | undefined;
	let deathFact: Fact | undefined;

	for (const fact of ordered) {
		if (fact.dimension === LIFE_DIMENSION) {
			const next = normalizeLifeState(fact.value);
			if (!next) {
				findings.push({ kind: 'unknownState', subject, fact, detail: fact.value });
				continue;
			}
			if (state !== undefined) {
				const verdict = checkLifeTransition(state, next);
				if (!verdict.ok && verdict.code === 'illegalTransition') {
					findings.push({
						kind: 'illegalLifeTransition',
						subject,
						fact,
						priorFact: deathFact,
						detail: `${verdict.from} → ${verdict.to}`,
					});
				}
			}
			if (next === 'dead' && !deathFact) {
				deathFact = fact;
			}
			state = next;
			continue;
		}

		// A non-life fact about someone already dead. Only a finding when it is
		// strictly later in story time — equal or unknown is not evidence.
		if (deathFact) {
			const order = compareStoryTime(fact.storyTime, deathFact.storyTime, options.eraOrder);
			if (order !== undefined && order > 0) {
				findings.push({
					kind: 'deadCharacterActs',
					subject,
					fact,
					priorFact: deathFact,
					detail: `${fact.dimension}=${fact.value}`,
				});
			}
		}
	}

	return findings;
}

/**
 * Two different values for one dimension at one moment.
 *
 * This is the rule that catches an item in two places, or a character both in
 * the capital and on the mountain, without needing a model of how things move.
 * It only fires on facts that share a story time exactly, which is a narrow
 * claim and therefore a safe one — no inference about travel or duration is
 * involved, only that a thing cannot be two things at once.
 */
function checkSimultaneousContradictions(subject: string, ordered: readonly Fact[], options: CheckFactsOptions): ConsistencyFinding[] {
	const findings: ConsistencyFinding[] = [];

	for (let i = 0; i < ordered.length; i++) {
		const fact = ordered[i];
		if (!fact.storyTime) {
			continue;
		}
		for (let j = i + 1; j < ordered.length; j++) {
			const other = ordered[j];
			if (compareStoryTime(fact.storyTime, other.storyTime, options.eraOrder) !== 0) {
				break;
			}
			if (other.dimension === fact.dimension && other.value !== fact.value) {
				findings.push({
					kind: 'contradictionAtSameTime',
					subject,
					fact: other,
					priorFact: fact,
					detail: `${fact.dimension}: ${fact.value} / ${other.value}`,
				});
			}
		}
	}

	return findings;
}
