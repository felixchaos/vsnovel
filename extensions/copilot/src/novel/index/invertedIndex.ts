/*---------------------------------------------------------------------------------------------
 *  VS Novel — lexical index.
 *--------------------------------------------------------------------------------------------*/

/**
 * Token → chunks, for exact recall.
 *
 * The keyword path is a first-class retrieval route here, not a fallback. Two
 * reasons, and the second is the one that decides it:
 *
 *  1. Invented proper nouns are the genre. An embedding of 玄冥子 lands next to
 *    other elders; a bigram match lands on 玄冥子.
 *  2. **It works offline.** Vector recall needs an embedding endpoint, and a
 *    manuscript tool that returns nothing when the network is down is a tool the
 *    author cannot rely on at the exact moment they are writing on a train.
 *
 * Scoring is deliberately plain — how many of the query's tokens a chunk
 * contains, weighted by how rare each token is. There is no BM25 here and that
 * is a choice: the corpus is one author's own book, term-frequency saturation
 * tuned on web documents does not transfer, and the result of this stage is
 * re-ranked anyway. What matters is that a chunk containing 玄冥 and 冥子 beats
 * one containing only 玄冥, and that a token appearing in every chapter counts
 * for less than one appearing in three.
 */

import { tokenize, tokenizeQuery } from './cjkTokenizer';

export interface IndexedChunk {
	readonly id: string;
	readonly text: string;
}

export interface LexicalHit {
	readonly chunkId: string;
	readonly score: number;
	/** Query tokens this chunk actually contained. Shown to explain the hit. */
	readonly matched: readonly string[];
}

/**
 * An in-memory inverted index.
 *
 * In-memory is a sizing decision, not laziness: a 4.85M-character manuscript is
 * roughly 1600 chunks, and the posting lists for it are a few megabytes. A
 * database would add a dependency, a schema migration and a failure mode, and
 * buy nothing at this scale.
 */
export class InvertedIndex {
	private readonly _postings = new Map<string, Set<string>>();
	private readonly _chunkTokens = new Map<string, ReadonlySet<string>>();

	get size(): number {
		return this._chunkTokens.size;
	}

	/**
	 * Adds or replaces a chunk.
	 *
	 * Replacement is remove-then-add rather than a diff: a chunk is small, the
	 * author rewrites one at a time, and a diff would be a second code path that
	 * can disagree with this one about what is indexed.
	 */
	add(chunk: IndexedChunk): void {
		this.remove(chunk.id);
		const tokens = new Set(tokenize(chunk.text));
		this._chunkTokens.set(chunk.id, tokens);
		for (const token of tokens) {
			const posting = this._postings.get(token);
			if (posting) {
				posting.add(chunk.id);
			} else {
				this._postings.set(token, new Set([chunk.id]));
			}
		}
	}

	remove(chunkId: string): void {
		const tokens = this._chunkTokens.get(chunkId);
		if (!tokens) {
			return;
		}
		for (const token of tokens) {
			const posting = this._postings.get(token);
			if (posting) {
				posting.delete(chunkId);
				// Dropping the empty set matters: without it, deleting a chapter
				// leaves its rare tokens behind as zero-length postings and the
				// idf of every surviving token drifts.
				if (posting.size === 0) {
					this._postings.delete(token);
				}
			}
		}
		this._chunkTokens.delete(chunkId);
	}

	/**
	 * Recalls chunks for a query, best first.
	 *
	 * Rarity weighting is `log(N / df)`. A token in every chunk contributes
	 * nothing, which is what keeps a query like 「他说」 from ranking the whole
	 * book equally and burying the one distinctive token in the same query.
	 */
	search(query: string, limit = 50): LexicalHit[] {
		const tokens = tokenizeQuery(query);
		if (tokens.length === 0 || this._chunkTokens.size === 0) {
			return [];
		}

		const total = this._chunkTokens.size;
		const scores = new Map<string, { score: number; matched: string[] }>();

		for (const token of tokens) {
			const posting = this._postings.get(token);
			if (!posting || posting.size === 0) {
				continue;
			}
			const weight = Math.log(total / posting.size) + 1;
			for (const chunkId of posting) {
				const entry = scores.get(chunkId);
				if (entry) {
					entry.score += weight;
					entry.matched.push(token);
				} else {
					scores.set(chunkId, { score: weight, matched: [token] });
				}
			}
		}

		return Array.from(scores, ([chunkId, { score, matched }]) => ({ chunkId, score, matched }))
			// Ties break on id so the same query always returns the same order —
			// an unstable ranking makes a cached prompt differ between turns, which
			// costs real money upstream.
			.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
			.slice(0, Math.max(0, limit));
	}
}
