/*---------------------------------------------------------------------------------------------
 *  VS Novel — reciprocal rank fusion.
 *--------------------------------------------------------------------------------------------*/

/**
 * Merges several ranked lists into one.
 *
 * The problem it solves: a lexical score and a cosine similarity are not
 * comparable numbers. One is a sum of log-weighted term hits, the other is
 * bounded in [-1, 1], and normalising them onto a shared scale requires knowing
 * each route's score distribution — which changes with the query, the corpus and
 * the embedding model.
 *
 * Reciprocal rank fusion sidesteps that entirely by throwing the scores away and
 * keeping only the positions. `1 / (K + rank)` per list, summed. A chunk that
 * both routes rank highly beats one that either route loves alone, and no
 * calibration is needed because ranks are already commensurable.
 *
 * The practical payoff for this product is that the two routes fail in opposite
 * directions: vectors are good at "the scene where he grieves" and hopeless at
 * 玄冥子; the lexical index is the reverse. Fusing them means a query only fails
 * when both fail — and when the network is down and there are no vectors at all,
 * the fused result degrades to the lexical one instead of to nothing.
 */

/**
 * The rank-smoothing constant.
 *
 * 60 is the value from the original formulation and is kept deliberately: it is
 * large enough that the gap between rank 1 and rank 2 does not dominate a list
 * that happens to be confident, which is what lets a merely-good hit on both
 * routes outrank a spectacular hit on one. Tuning it is a relevance experiment,
 * not a free parameter to adjust when a single query looks wrong.
 */
export const RRF_K = 60;

export interface RankedList {
	/** Where these came from, e.g. 'lexical' or 'vector'. Kept for explanation. */
	readonly source: string;
	/** Chunk ids, best first. */
	readonly ids: readonly string[];
	/**
	 * Relative influence. Defaults to 1.
	 *
	 * A route that is known to be weaker for a given workspace — no embeddings
	 * yet, a partial index — can be down-weighted rather than switched off, which
	 * keeps its unique finds reachable.
	 */
	readonly weight?: number;
}

export interface FusedHit {
	readonly chunkId: string;
	readonly score: number;
	/** Which lists contributed, and at what rank. For showing the author why. */
	readonly ranks: readonly { readonly source: string; readonly rank: number }[];
}

/**
 * Fuses ranked lists.
 *
 * Empty lists are skipped rather than treated as evidence of absence: a vector
 * route that returned nothing because the endpoint is unreachable must not push
 * anything down. That distinction is why the offline case degrades gracefully.
 */
export function fuse(lists: readonly RankedList[], limit = 50): FusedHit[] {
	const scores = new Map<string, { score: number; ranks: { source: string; rank: number }[] }>();

	for (const list of lists) {
		const weight = list.weight ?? 1;
		list.ids.forEach((chunkId, index) => {
			const rank = index + 1;
			const contribution = weight / (RRF_K + rank);
			const entry = scores.get(chunkId);
			if (entry) {
				entry.score += contribution;
				entry.ranks.push({ source: list.source, rank });
			} else {
				scores.set(chunkId, { score: contribution, ranks: [{ source: list.source, rank }] });
			}
		});
	}

	return Array.from(scores, ([chunkId, { score, ranks }]) => ({ chunkId, score, ranks }))
		// Ties break on id, for the same reason every other ranking here does: a
		// prompt that reshuffles between turns invalidates the upstream cache.
		.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
		.slice(0, Math.max(0, limit));
}
