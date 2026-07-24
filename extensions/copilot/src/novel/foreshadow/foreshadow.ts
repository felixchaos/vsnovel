/*---------------------------------------------------------------------------------------------
 *  VS Novel — foreshadowing, as a boolean.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tracks promises the manuscript has made to the reader, and reports the ones
 * it has not kept.
 *
 * The move that makes this tractable: **the author writes the payoff condition
 * themselves.** Inferring "has this thread been resolved" from prose is an
 * open-ended judgement with no stable answer, and a tool that guesses will be
 * confidently wrong about the one thread the author cared most about. Written
 * down, the same question is `prerequisites.every(met)` — a boolean, checkable,
 * explainable, and wrong only when the author's own note is wrong.
 *
 * The window is in narrative order rather than story time, and that is
 * deliberate: an unpaid promise is a fact about the *reader's* experience. A
 * revelation the author placed forty chapters after its hint is overdue even if
 * the two are minutes apart inside the story.
 *
 * An unrecognised condition evaluates to false. That is the conservative
 * direction: a condition nobody can evaluate leaves the thread firable-but-not-
 * fired, which shows up as something to look at, rather than silently marking a
 * promise kept.
 */

import type { Anchor } from '../facts/fact';
import type { Fact } from '../facts/fact';

/** A point in reading order. Chapter × 1000 + offset, by the fact convention. */
export type NarrativePosition = number;

export interface FlagCondition {
	readonly kind: 'flag';
	readonly flag: string;
}

export interface FactExistsCondition {
	readonly kind: 'factExists';
	readonly subject: string;
	readonly dimension: string;
	/** When omitted, any value satisfies it. */
	readonly value?: string;
}

export interface ChapterAfterCondition {
	readonly kind: 'chapterAfter';
	readonly narrativeOrder: NarrativePosition;
}

export interface ForeshadowPaidOffCondition {
	readonly kind: 'foreshadowPaidOff';
	readonly id: string;
}

/**
 * Any condition, including ones this build does not know.
 *
 * Unknown kinds are representable on purpose: a workspace written against a
 * later version must load and be checkable, with the unknown condition simply
 * never satisfied, rather than failing to parse and taking the whole file with
 * it.
 */
export type Condition =
	| FlagCondition
	| FactExistsCondition
	| ChapterAfterCondition
	| ForeshadowPaidOffCondition
	| { readonly kind: string };

export interface Foreshadow {
	readonly id: string;
	readonly title: string;
	/** Where the promise was made. */
	readonly plantedAt: NarrativePosition;
	readonly anchor?: Anchor;
	/** All must hold before the payoff can be written. Empty means always firable. */
	readonly prerequisites?: readonly Condition[];
	/**
	 * When the payoff is expected.
	 *
	 * `to` is what makes a thread overdue. Omitting it means the author has not
	 * promised a deadline, and no amount of elapsed manuscript makes it late.
	 */
	readonly window?: { readonly from?: NarrativePosition; readonly to?: NarrativePosition };
	/** Set once the payoff is written. */
	readonly paidOffAt?: NarrativePosition;
}

/** What conditions are evaluated against. */
export interface WorldView {
	/** Author-set flags. */
	readonly flags?: ReadonlySet<string>;
	readonly facts?: readonly Fact[];
	/** Ids of threads already paid off. */
	readonly paidOff?: ReadonlySet<string>;
	/** How far the manuscript has been written. */
	readonly position: NarrativePosition;
}

/**
 * Evaluates one condition.
 *
 * Unknown kinds return false — see the note on {@link Condition}.
 */
export function evalCondition(condition: Condition, world: WorldView): boolean {
	switch (condition.kind) {
		case 'flag':
			return world.flags?.has((condition as FlagCondition).flag) ?? false;
		case 'factExists': {
			const c = condition as FactExistsCondition;
			return (world.facts ?? []).some(fact =>
				fact.subject === c.subject &&
				fact.dimension === c.dimension &&
				(c.value === undefined || fact.value === c.value));
		}
		case 'chapterAfter':
			return world.position >= (condition as ChapterAfterCondition).narrativeOrder;
		case 'foreshadowPaidOff':
			return world.paidOff?.has((condition as ForeshadowPaidOffCondition).id) ?? false;
		default:
			return false;
	}
}

/**
 * Whether a thread's payoff can be written now.
 *
 * "Can", not "must". The window's `from` gates it and its `to` does not: a
 * thread past its deadline is still firable — being late is a reason to write
 * it, not a reason to forbid it.
 */
export function isFirable(entry: Foreshadow, world: WorldView): boolean {
	if (entry.paidOffAt !== undefined) {
		return false;
	}
	if (entry.window?.from !== undefined && world.position < entry.window.from) {
		return false;
	}
	return (entry.prerequisites ?? []).every(condition => evalCondition(condition, world));
}

export interface OverdueEntry {
	readonly entry: Foreshadow;
	/** How far past the deadline, in narrative order. */
	readonly by: number;
	/** Prerequisites still unmet — why it may not have been written yet. */
	readonly blockedBy: readonly Condition[];
}

/**
 * Threads whose deadline has passed without a payoff.
 *
 * Unmet prerequisites are reported alongside, because the two readings are
 * different problems: a thread that is overdue *and* firable is one the author
 * forgot, while one that is overdue and blocked usually means the plan itself
 * needs revisiting. Presenting them identically would hide that.
 */
export function overdue(entries: readonly Foreshadow[], world: WorldView): OverdueEntry[] {
	const result: OverdueEntry[] = [];
	for (const entry of entries) {
		if (entry.paidOffAt !== undefined) {
			continue;
		}
		const deadline = entry.window?.to;
		if (deadline === undefined || world.position <= deadline) {
			continue;
		}
		result.push({
			entry,
			by: world.position - deadline,
			blockedBy: (entry.prerequisites ?? []).filter(condition => !evalCondition(condition, world)),
		});
	}
	// Most overdue first: the promise the reader has been waiting longest for is
	// the one most worth showing at the top of the list.
	return result.sort((a, b) => b.by - a.by || a.entry.id.localeCompare(b.entry.id));
}

/**
 * Threads that could be written now.
 *
 * The other half of the same question, and the one that is actually useful while
 * drafting: not "what did I forget" but "what is ready".
 */
export function firable(entries: readonly Foreshadow[], world: WorldView): Foreshadow[] {
	return entries
		.filter(entry => isFirable(entry, world))
		.sort((a, b) => a.plantedAt - b.plantedAt || a.id.localeCompare(b.id));
}
