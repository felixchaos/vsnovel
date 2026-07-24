/*---------------------------------------------------------------------------------------------
 *  VS Novel — character name resolution and drift detection.
 *--------------------------------------------------------------------------------------------*/

/**
 * Resolves the ways a character is referred to, and reports where a manuscript
 * has drifted away from their real name.
 *
 * This is deliberately a lookup table rather than a retrieval problem. Whether
 * 师父 means 李慕白 in a given paragraph is a fact the author already knows and
 * has already written down; asking a model to infer it converts a certainty into
 * a guess, and a guess that is wrong in a long series is worse than no answer.
 * So the relation is data — see {@link AddressRelation} — and this module is the
 * deterministic reader of it.
 *
 * It observes; it does not rewrite. Every finding is offered to the author as a
 * diagnostic with an optional fix, never applied. A tool that silently renames
 * across a manuscript is one bad inference away from destroying a draft, and
 * the author is the only one who knows whether 那男人 was sloppiness or the
 * point of the scene.
 */

import { AhoCorasick } from '../index/ahoCorasick';
import { hasCJK } from '../index/cjkTokenizer';
import { isWordBounded } from '../index/wordBoundary';
import type { LangCode } from '../lang';

export type { LangCode };

/** Aliases either apply to every language, or are bucketed per language. */
export type Aliases = readonly string[] | Partial<Record<LangCode, readonly string[]>>;

/**
 * How one character addresses another.
 *
 * The dimension the naive design is missing. In Chinese and Japanese prose the
 * ordinary way to name someone is by relation — 师父, 大哥, お兄ちゃん — and the
 * referent depends entirely on whose point of view the passage is in. Recording
 * it as a relation makes 师父 resolve to 李慕白 inside 张小凡's scenes and stay
 * unresolved elsewhere, which is exactly right: in someone else's scene the same
 * word means someone else, and resolving it would be a fabricated fact.
 */
export interface AddressRelation {
	/** Character id being addressed. */
	readonly to: string;
	/** The surface form used, e.g. 师父. */
	readonly as: string;
	/** Informational, e.g. 师徒. Carried through so the author sees why. */
	readonly kind?: string;
	/** Which language bucket this form belongs to. Unset means every language. */
	readonly lang?: LangCode;
}

export interface Character {
	/** Stable id. Not the name — a renamed character must keep its identity. */
	readonly id: string;
	/** The name the manuscript should settle on. */
	readonly canonical: string;
	readonly aliases?: Aliases;
	/** Surface forms *this* character uses for others, active in their scenes. */
	readonly addresses?: readonly AddressRelation[];
}

export type MentionKind = 'canonical' | 'alias' | 'address';

export interface Mention {
	readonly characterId: string;
	readonly surface: string;
	readonly kind: MentionKind;
	readonly start: number;
	readonly end: number;
}

export interface AliasDrift {
	readonly characterId: string;
	readonly canonical: string;
	/** The alias occurrences that stood in for a name never actually written. */
	readonly mentions: readonly Mention[];
}

export interface NameCheckResult {
	/** Every resolved occurrence, in document order. */
	readonly mentions: readonly Mention[];
	/**
	 * Characters named only by alias in this passage.
	 *
	 * The signal the author wants: they slipped into calling him 慕白 and never
	 * wrote 李慕白, so a reader arriving at this chapter has no anchor.
	 */
	readonly aliasDrift: readonly AliasDrift[];
	/** Cast members present in the scene but never named. Ids. */
	readonly castUnmentioned: readonly string[];
	/**
	 * Surfaces that resolved to more than one character and were therefore left
	 * unresolved. A data problem for the author to fix, not something to guess.
	 */
	readonly ambiguous: readonly { readonly surface: string; readonly characterIds: readonly string[] }[];
}

export interface CheckOptions {
	/** Character ids expected in the scene. Drives {@link NameCheckResult.castUnmentioned}. */
	readonly cast?: readonly string[];
	/** Whose point of view the passage is in. Enables that character's address forms. */
	readonly pov?: string;
	/** Which alias bucket applies. Unset scans every bucket. */
	readonly lang?: LangCode;
}

/** One registered surface form and what it points at. */
interface Surface {
	readonly text: string;
	readonly characterId: string;
	readonly kind: MentionKind;
	/** Set for an address form: only active when this character holds the POV. */
	readonly povOwner?: string;
	readonly lang?: LangCode;
	/** True when the form is Latin-only and needs word-boundary checking. */
	readonly needsBoundary: boolean;
}

export class NameIndex {
	private constructor(
		private readonly characters: ReadonlyMap<string, Character>,
		private readonly surfaces: readonly Surface[],
		private readonly automaton: AhoCorasick,
	) { }

	static build(characters: readonly Character[]): NameIndex {
		const byId = new Map<string, Character>();
		const surfaces: Surface[] = [];

		const add = (text: string, characterId: string, kind: MentionKind, lang?: LangCode, povOwner?: string) => {
			const trimmed = text.trim();
			if (!trimmed) {
				return;
			}
			surfaces.push({
				text: trimmed,
				characterId,
				kind,
				lang,
				povOwner,
				// A form written in Han or kana can be matched by substring, because
				// the script has no separators. A Latin form cannot: "Al" occurs
				// inside "Also" and "metal", and matching it there would put a
				// character in scenes they are not in.
				needsBoundary: !hasCJK(trimmed),
			});
		};

		for (const character of characters) {
			byId.set(character.id, character);
			add(character.canonical, character.id, 'canonical');

			const aliases = character.aliases;
			if (Array.isArray(aliases)) {
				for (const alias of aliases) {
					add(alias, character.id, 'alias');
				}
			} else if (aliases) {
				for (const [lang, forms] of Object.entries(aliases as Partial<Record<LangCode, readonly string[]>>)) {
					for (const alias of forms ?? []) {
						add(alias, character.id, 'alias', lang as LangCode);
					}
				}
			}

			for (const relation of character.addresses ?? []) {
				// povOwner is the character doing the addressing; `to` is who the
				// word points at.
				add(relation.as, relation.to, 'address', relation.lang, character.id);
			}
		}

		// The automaton is built over case-folded text so a Latin form matches
		// regardless of how the author capitalised it. CJK folding is a no-op.
		return new NameIndex(byId, surfaces, AhoCorasick.build(surfaces.map(s => s.text.toLocaleLowerCase())));
	}

	/** The registered characters, by id. */
	get size(): number {
		return this.characters.size;
	}

	/**
	 * Resolves one surface form to a character id.
	 *
	 * Returns undefined when the form is unknown, or when it is ambiguous under
	 * the given point of view — an ambiguous name is a question for the author,
	 * and answering it here would be a guess wearing a fact's clothing.
	 */
	resolve(surface: string, options: Pick<CheckOptions, 'pov' | 'lang'> = {}): string | undefined {
		const folded = surface.trim().toLocaleLowerCase();
		const ids = new Set(
			this.surfaces
				.filter(s => s.text.toLocaleLowerCase() === folded && this.isActive(s, options))
				.map(s => s.characterId),
		);
		return ids.size === 1 ? ids.values().next().value : undefined;
	}

	/** The canonical name for an id, if registered. */
	canonical(characterId: string): string | undefined {
		return this.characters.get(characterId)?.canonical;
	}

	/**
	 * Scans prose and reports what it found.
	 *
	 * One pass over the text regardless of cast size — see {@link AhoCorasick}.
	 * This runs on the keystroke path, so the cost has to be a function of the
	 * text being edited, not of how many characters the series has accumulated.
	 */
	check(prose: string, options: CheckOptions = {}): NameCheckResult {
		const folded = prose.toLocaleLowerCase();
		const candidates: (Mention & { readonly length: number })[] = [];
		const ambiguousSurfaces = new Map<string, Set<string>>();

		// Group raw hits by span so an ambiguous surface is detected before it is
		// turned into a mention.
		const bySpan = new Map<string, { surface: Surface; start: number; end: number }[]>();
		this.automaton.forEach(folded, match => {
			const surface = this.surfaces[match.patternId];
			if (!this.isActive(surface, options)) {
				return;
			}
			if (surface.needsBoundary && !isWordBounded(folded, match.start, match.end)) {
				return;
			}
			const key = `${match.start}:${match.end}`;
			const bucket = bySpan.get(key);
			if (bucket) {
				bucket.push({ surface, start: match.start, end: match.end });
			} else {
				bySpan.set(key, [{ surface, start: match.start, end: match.end }]);
			}
		});

		for (const hits of bySpan.values()) {
			const ids = new Set(hits.map(h => h.surface.characterId));
			const { start, end } = hits[0];
			if (ids.size > 1) {
				const surfaceText = prose.slice(start, end);
				const seen = ambiguousSurfaces.get(surfaceText) ?? new Set<string>();
				for (const id of ids) {
					seen.add(id);
				}
				ambiguousSurfaces.set(surfaceText, seen);
				continue;
			}
			// Canonical wins over alias when the same span is registered as both,
			// so a mention is not reported as drift against itself.
			const best = hits.slice().sort((a, b) => kindRank(a.surface.kind) - kindRank(b.surface.kind))[0];
			candidates.push({
				characterId: best.surface.characterId,
				surface: prose.slice(start, end),
				kind: best.surface.kind,
				start,
				end,
				length: end - start,
			});
		}

		// Longest match wins: 李慕白 is one mention, not 李慕白 plus 慕白. Ties go
		// to the earlier span so the result is document-ordered and stable.
		candidates.sort((a, b) => b.length - a.length || a.start - b.start);
		const taken: Mention[] = [];
		for (const candidate of candidates) {
			if (!taken.some(m => candidate.start < m.end && m.start < candidate.end)) {
				taken.push(candidate);
			}
		}
		taken.sort((a, b) => a.start - b.start);

		return {
			mentions: taken,
			aliasDrift: this.driftFrom(taken),
			castUnmentioned: (options.cast ?? []).filter(id => !taken.some(m => m.characterId === id)),
			ambiguous: Array.from(ambiguousSurfaces, ([surface, ids]) => ({
				surface,
				characterIds: Array.from(ids).sort(),
			})),
		};
	}

	/** Whether a surface form applies under the given POV and language. */
	private isActive(surface: Surface, options: Pick<CheckOptions, 'pov' | 'lang'>): boolean {
		if (surface.povOwner !== undefined && surface.povOwner !== options.pov) {
			return false;
		}
		if (options.lang !== undefined && surface.lang !== undefined && surface.lang !== options.lang) {
			return false;
		}
		return true;
	}

	/**
	 * Characters mentioned only by alias.
	 *
	 * An address form is not drift — 师父 is how the viewpoint character actually
	 * thinks of him, and demanding the full name there would be bad prose advice.
	 * Only a registered alias standing in for a name that never appears counts.
	 */
	private driftFrom(mentions: readonly Mention[]): AliasDrift[] {
		const byCharacter = new Map<string, Mention[]>();
		for (const mention of mentions) {
			const bucket = byCharacter.get(mention.characterId);
			if (bucket) {
				bucket.push(mention);
			} else {
				byCharacter.set(mention.characterId, [mention]);
			}
		}

		const drift: AliasDrift[] = [];
		for (const [characterId, group] of byCharacter) {
			if (group.some(m => m.kind === 'canonical')) {
				continue;
			}
			const aliasMentions = group.filter(m => m.kind === 'alias');
			if (aliasMentions.length === 0) {
				continue;
			}
			drift.push({
				characterId,
				canonical: this.characters.get(characterId)?.canonical ?? characterId,
				mentions: aliasMentions,
			});
		}
		return drift.sort((a, b) => a.mentions[0].start - b.mentions[0].start);
	}
}

function kindRank(kind: MentionKind): number {
	return kind === 'canonical' ? 0 : kind === 'alias' ? 1 : 2;
}

/**
 * Whether a span is a whole word.
 *
 * Uses Unicode letter/number classes rather than `\b`, which is defined over
 * ASCII word characters and would call the boundary in "Zoë|" wrongly.
 */
