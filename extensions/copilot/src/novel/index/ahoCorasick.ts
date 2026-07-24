/*---------------------------------------------------------------------------------------------
 *  VS Novel — multi-pattern search.
 *--------------------------------------------------------------------------------------------*/

/**
 * Finds every occurrence of many patterns in one pass.
 *
 * The naive alternative — `indexOf` per pattern — is O(patterns × text), and
 * both factors are large here: a long-running series carries hundreds of named
 * entities, and the manuscript runs to millions of characters. Worse, that cost
 * lands on the keystroke path, because name checking is a diagnostic that reruns
 * as the author types. Aho-Corasick makes it O(text + matches) regardless of how
 * many names the cast has grown to.
 *
 * Matching is over UTF-16 code units, which is what `string.length` and VS Code
 * `Position` both count, so a reported offset can be handed straight to a
 * `Range` without conversion. Every pattern used here is BMP — Han, kana, Latin
 * — so a code unit is a character; an emoji in a name would match as two units
 * and still report a usable offset.
 */

interface Node {
	/** Next state per code unit. A Map, not an array: the alphabet is Unicode. */
	readonly next: Map<number, number>;
	/** Longest proper suffix of this state that is also a prefix of some pattern. */
	fail: number;
	/** Pattern ids ending exactly here. */
	readonly outputs: number[];
	/**
	 * Nearest ancestor through fail links that has outputs, or -1.
	 *
	 * Precomputed so reporting matches walks only over states that actually
	 * produce one. Without it, every position walks the whole fail chain and the
	 * automaton loses its linear bound on text that is one long run of a single
	 * repeated character — which Chinese punctuation runs genuinely are.
	 */
	outputLink: number;
}

export interface Match {
	/** Index into the pattern array given to {@link AhoCorasick.build}. */
	readonly patternId: number;
	/** Offset of the first code unit of the occurrence. */
	readonly start: number;
	/** Offset one past the last code unit. */
	readonly end: number;
}

export class AhoCorasick {
	private constructor(
		private readonly nodes: readonly Node[],
		private readonly lengths: readonly number[],
	) { }

	/** How many patterns the automaton carries. */
	get size(): number {
		return this.lengths.length;
	}

	/**
	 * Compiles the patterns.
	 *
	 * Empty patterns are kept in the id space but never match, so a caller can
	 * index its own parallel array by pattern id without filtering first — the
	 * ids stay aligned with what was passed in.
	 */
	static build(patterns: readonly string[]): AhoCorasick {
		const nodes: Node[] = [newNode()];

		for (let id = 0; id < patterns.length; id++) {
			const pattern = patterns[id];
			if (pattern.length === 0) {
				continue;
			}
			let state = 0;
			for (let i = 0; i < pattern.length; i++) {
				const unit = pattern.charCodeAt(i);
				let next = nodes[state].next.get(unit);
				if (next === undefined) {
					next = nodes.length;
					nodes.push(newNode());
					nodes[state].next.set(unit, next);
				}
				state = next;
			}
			nodes[state].outputs.push(id);
		}

		// Breadth-first fail links: a state's fail target is always shallower, so
		// it is already resolved by the time this reaches the state.
		const queue: number[] = [];
		for (const child of nodes[0].next.values()) {
			nodes[child].fail = 0;
			queue.push(child);
		}
		for (let head = 0; head < queue.length; head++) {
			const state = queue[head];
			const node = nodes[state];
			node.outputLink = nodes[node.fail].outputs.length > 0 ? node.fail : nodes[node.fail].outputLink;

			for (const [unit, child] of node.next) {
				let fail = node.fail;
				let candidate = nodes[fail].next.get(unit);
				while (candidate === undefined && fail !== 0) {
					fail = nodes[fail].fail;
					candidate = nodes[fail].next.get(unit);
				}
				nodes[child].fail = candidate === undefined || candidate === child ? 0 : candidate;
				queue.push(child);
			}
		}

		return new AhoCorasick(nodes, patterns.map(p => p.length));
	}

	/**
	 * Reports every occurrence, including overlaps and nesting.
	 *
	 * Both matter for names: 李慕白 contains 慕白, and an author who registered
	 * both as surface forms of the same character needs the longer one to win —
	 * a decision the caller makes, which it can only make if it is told about
	 * both. Filtering here would take that choice away.
	 */
	findAll(text: string): Match[] {
		const matches: Match[] = [];
		this.forEach(text, m => { matches.push(m); });
		return matches;
	}

	/**
	 * Streams occurrences to `visit`.
	 *
	 * Kept separate from {@link findAll} so a diagnostic pass over a whole
	 * manuscript does not have to materialise every hit — on a long book the
	 * match list is larger than the chapter that produced it.
	 */
	forEach(text: string, visit: (match: Match) => void): void {
		if (this.nodes.length === 1) {
			return;
		}
		let state = 0;
		for (let i = 0; i < text.length; i++) {
			const unit = text.charCodeAt(i);
			for (;;) {
				const next = this.nodes[state].next.get(unit);
				if (next !== undefined) {
					state = next;
					break;
				}
				if (state === 0) {
					break;
				}
				state = this.nodes[state].fail;
			}

			for (let out = this.nodes[state].outputs.length > 0 ? state : this.nodes[state].outputLink; out !== -1; out = this.nodes[out].outputLink) {
				for (const patternId of this.nodes[out].outputs) {
					visit({ patternId, start: i + 1 - this.lengths[patternId], end: i + 1 });
				}
			}
		}
	}
}

function newNode(): Node {
	return { next: new Map(), fail: 0, outputs: [], outputLink: -1 };
}
