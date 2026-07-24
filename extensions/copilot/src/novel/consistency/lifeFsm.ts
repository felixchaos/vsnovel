/*---------------------------------------------------------------------------------------------
 *  VS Novel — life-state machine.
 *--------------------------------------------------------------------------------------------*/

/**
 * Validates transitions of a character's life state.
 *
 * Small on purpose. The mechanism is a transition table; the work is in the
 * table and in the alias list, and both are the sort of thing that is obvious
 * once written and impossible to get right by inference.
 *
 * Two design commitments:
 *
 *  - **`dead` is terminal.** Everything else can move to anything else — a
 *    character reported missing turns up injured, an injured one recovers. Only
 *    death is one-way, and a manuscript that moves out of it is either a
 *    resurrection the author meant (and will say so) or the mistake this exists
 *    to catch.
 *  - **A verdict is returned, never applied.** The predecessor's own note was
 *    that the write decision belongs to the caller, and that is right for a
 *    stronger reason here: a novel is allowed to contradict itself on purpose,
 *    and a checker that silently corrected the record would be overwriting the
 *    author's intent with its own.
 *
 * The alias table is three-language because the same manuscript is. It also does
 * double duty for translation: a translated chapter has to map its state words
 * onto the same canonical state as the source, or every character's status
 * appears to change the moment the language does.
 */

export type LifeState = 'alive' | 'injured' | 'missing' | 'unknown' | 'dead';

export const LIFE_STATES: readonly LifeState[] = ['alive', 'injured', 'missing', 'unknown', 'dead'];

/**
 * Legal transitions.
 *
 * Read as "from → the states it may become". `dead` maps to itself alone, which
 * is the whole rule; everything else is fully connected because a story may move
 * a character between those freely and often does.
 */
export const LIFE_TRANSITIONS: Readonly<Record<LifeState, ReadonlySet<LifeState>>> = {
	alive: new Set<LifeState>(['alive', 'injured', 'missing', 'unknown', 'dead']),
	injured: new Set<LifeState>(['alive', 'injured', 'missing', 'unknown', 'dead']),
	missing: new Set<LifeState>(['alive', 'injured', 'missing', 'unknown', 'dead']),
	unknown: new Set<LifeState>(['alive', 'injured', 'missing', 'unknown', 'dead']),
	dead: new Set<LifeState>(['dead']),
};

/**
 * Surface words that mean each state, across the three languages in scope.
 *
 * Matched case-folded and whitespace-trimmed. Not exhaustive and not meant to
 * be: an unrecognised word is reported rather than guessed at, because a state
 * quietly parsed as the wrong one is worse than one the author is asked about.
 */
const LIFE_ALIASES: ReadonlyMap<string, LifeState> = new Map<string, LifeState>([
	// Chinese
	['活着', 'alive'], ['存活', 'alive'], ['生还', 'alive'], ['健在', 'alive'], ['无恙', 'alive'],
	['受伤', 'injured'], ['负伤', 'injured'], ['重伤', 'injured'], ['轻伤', 'injured'],
	['失踪', 'missing'], ['下落不明', 'missing'], ['失联', 'missing'],
	['未知', 'unknown'], ['不明', 'unknown'],
	['死亡', 'dead'], ['身亡', 'dead'], ['已故', 'dead'], ['去世', 'dead'], ['殒命', 'dead'],
	['战死', 'dead'], ['阵亡', 'dead'], ['逝世', 'dead'],
	// Japanese
	['生存', 'alive'], ['存命', 'alive'],
	['負傷', 'injured'], ['重傷', 'injured'],
	['行方不明', 'missing'],
	['死去', 'dead'], ['亡くなる', 'dead'], ['亡くなった', 'dead'], ['他界', 'dead'], ['死没', 'dead'],
	// English
	['alive', 'alive'], ['living', 'alive'], ['survived', 'alive'], ['well', 'alive'],
	['injured', 'injured'], ['wounded', 'injured'], ['hurt', 'injured'],
	['missing', 'missing'], ['lost', 'missing'], ['disappeared', 'missing'],
	['unknown', 'unknown'], ['unclear', 'unknown'],
	['dead', 'dead'], ['deceased', 'dead'], ['passed away', 'dead'], ['killed', 'dead'], ['died', 'dead'],
]);

/**
 * Maps a written state word onto the canonical state.
 *
 * Returns undefined for anything unrecognised — see {@link LIFE_ALIASES} for why
 * that is preferred to a best guess.
 */
export function normalizeLifeState(raw: string): LifeState | undefined {
	const key = raw.trim().toLocaleLowerCase();
	if (!key) {
		return undefined;
	}
	if ((LIFE_STATES as readonly string[]).includes(key)) {
		return key as LifeState;
	}
	return LIFE_ALIASES.get(key);
}

export type VerdictCode =
	/** The transition is allowed. */
	| 'ok'
	/** Moving out of a terminal state. */
	| 'illegalTransition'
	/** A state word that is not in the alias table. */
	| 'unknownState';

export interface Verdict {
	readonly code: VerdictCode;
	readonly ok: boolean;
	readonly from?: LifeState;
	readonly to?: LifeState;
	/** The raw text, when it could not be normalised. */
	readonly raw?: string;
}

/**
 * Judges one transition.
 *
 * Both sides are normalised first, so `身亡 → alive` and `dead → 活着` are the
 * same finding in either language.
 */
export function checkLifeTransition(from: string, to: string): Verdict {
	const fromState = normalizeLifeState(from);
	if (!fromState) {
		return { code: 'unknownState', ok: false, raw: from };
	}
	const toState = normalizeLifeState(to);
	if (!toState) {
		return { code: 'unknownState', ok: false, raw: to };
	}
	if (!LIFE_TRANSITIONS[fromState].has(toState)) {
		return { code: 'illegalTransition', ok: false, from: fromState, to: toState };
	}
	return { code: 'ok', ok: true, from: fromState, to: toState };
}

/**
 * Judges a whole sequence, reporting every illegal step rather than the first.
 *
 * Stopping at the first would hide the shape of the problem: a character who
 * dies twice and revives twice is a different manuscript issue from one who
 * revives once, and the author needs to see both.
 */
export function checkLifeSequence(states: readonly string[]): Verdict[] {
	const verdicts: Verdict[] = [];
	let current: LifeState | undefined;
	for (const raw of states) {
		const state = normalizeLifeState(raw);
		if (!state) {
			verdicts.push({ code: 'unknownState', ok: false, raw });
			continue;
		}
		if (current !== undefined && !LIFE_TRANSITIONS[current].has(state)) {
			verdicts.push({ code: 'illegalTransition', ok: false, from: current, to: state });
		}
		// The state advances even after an illegal step. Refusing to advance would
		// report every later state against the pre-death one and bury the first
		// real finding under a cascade.
		current = state;
	}
	return verdicts;
}
