/*---------------------------------------------------------------------------------------------
 *  VS Novel — capabilities for models served by a relay we have never seen.
 *--------------------------------------------------------------------------------------------*/

/**
 * A relay ("中转站") resells other vendors' models behind one OpenAI-compatible
 * base URL and one key. It is how a large share of this product's authors buy
 * access, and it is the one BYOK case where a fixed catalogue cannot work: the
 * model list belongs to whoever runs the host, changes without notice, and is
 * different on every relay.
 *
 * So this file answers a narrower question than `catalog.ts` does. Not "what is
 * this model", which we cannot know, but "what should we assume so that pasting
 * a URL and a key produces a usable picker instead of an empty one".
 *
 * Three rules follow from that, and each is a decision about which way to be
 * wrong:
 *
 * - **Skip what is not a chat model.** Every relay's listing carries embeddings,
 *   rerankers, image and video models. `bge-m3` in a chat picker is not a
 *   cosmetic problem: the author picks it, the request fails in the provider's
 *   own wording, and nothing in that message says "this was never a chat model".
 *
 * - **Reuse `catalog.ts` on an exact id match.** A relay serving
 *   `deepseek-v4-pro` is serving the model that file already documents from the
 *   vendor's own numbers. Falling back to a generic default there would throw
 *   away measured facts — the six reasoning levels, the 1M window — for no
 *   reason.
 *
 * - **Where we are guessing, guess low, and say so.** Every number below that is
 *   not from `catalog.ts` is a default chosen for how it fails, not a claim
 *   about the model. Too small only wastes budget the author paid for; too large
 *   is an HTTP 400 in the provider's dialect that no novelist can act on. An
 *   author who knows the real figures is better served by `Custom Endpoint`,
 *   which asks for them directly.
 *
 * `editTools` is the one place this file is deliberately generous, and
 * `catalog.ts` already argues why: a model that handles string replacement badly
 * retries and recovers, while a model denied it rewrites the entire chapter on
 * every edit, forever. The asymmetry decides the doubt.
 */

import type { BYOKModelCapabilities } from '../../extension/byok/common/byokProvider';
import { DEEPSEEK_MODELS, GLM_MODELS, KIMI_MODELS, MINIMAX_MODELS, QWEN_MODELS } from './catalog';

/**
 * Same set `catalog.ts` grants, for the reason quoted above. Spelled `as const`
 * and spread for the same reason it is there: a bare `string[]` is not an
 * `EndpointEditToolName[]`, and the widening is only caught at the assignment.
 */
const EDIT_TOOLS = ['find-replace', 'multi-find-replace'] as const;
const editTools = [...EDIT_TOOLS];

/**
 * Grok, from xAI's own model list.
 *
 * Recorded rather than guessed because the family default was badly wrong for
 * it: every documented member is at least 256K and the newest are 500K or 1M,
 * while the generic floor handed them 128K. An author on `grok-4.6` was being
 * given a quarter of the context they had paid for, silently.
 *
 * Windows are from https://docs.x.ai/docs/models, read 2026-08-23. The `grok-4.6`
 * row is from its own page, which also states vision, function calling and
 * reasoning; the rest carry only the window, so their booleans stay at the
 * family's assumption and are marked as such.
 *
 * `maxOutputTokens` is not published for any of them. 32K is this file's own
 * conservative figure, not xAI's — too low only truncates a reply the author can
 * continue, while too high is a 400 they cannot read.
 */
export const GROK_MODELS: Record<string, BYOKModelCapabilities> = {
	// Window, vision, tool calling and reasoning all from docs.x.ai/docs/models/grok-4.6.
	'grok-4.6': { name: 'grok-4.6', contextWindow: 500_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, thinking: true, editTools },
	// Window sourced; booleans assumed from the family.
	'grok-4.5': { name: 'grok-4.5', contextWindow: 500_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, editTools },
	'grok-4.3': { name: 'grok-4.3', contextWindow: 1_000_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, editTools },
	'grok-4.20-0309-reasoning': { name: 'grok-4.20-0309-reasoning', contextWindow: 1_000_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, thinking: true, editTools },
	'grok-4.20-0309-non-reasoning': { name: 'grok-4.20-0309-non-reasoning', contextWindow: 1_000_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, editTools },
	'grok-4.20-multi-agent-0309': { name: 'grok-4.20-multi-agent-0309', contextWindow: 1_000_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, editTools },
	'grok-build-0.1': { name: 'grok-build-0.1', contextWindow: 256_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, editTools },
};

/**
 * Everything `catalog.ts` documents, searched on exact match.
 *
 * Keyed by the *lowercased* id, because the two sides disagree about case and
 * only one of them is ours: `catalog.ts` spells MiniMax's model the way MiniMax
 * does, `MiniMax-M3`, while the relay lists it as `minimax-m3`. Lowercasing the
 * query alone — which is what this did first — matches neither, silently, and
 * the model drops to the unknown default with a 128K window instead of the 1M
 * one we measured. Nothing about that failure is visible from the picker.
 *
 * Order matters only if two vendors ever ship the same id, which none of these
 * do; the spread is written vendor-by-vendor so a collision would be visible in
 * a diff rather than silently resolved.
 */
const DOCUMENTED: Record<string, BYOKModelCapabilities> = Object.fromEntries(
	Object.entries({
		...DEEPSEEK_MODELS,
		...KIMI_MODELS,
		...GLM_MODELS,
		...QWEN_MODELS,
		...MINIMAX_MODELS,
		...GROK_MODELS,
	}).map(([id, caps]) => [id.toLowerCase(), caps])
);

/**
 * Ids that are not chat models.
 *
 * Matched against the lowercased id. These are drawn from what the relays this
 * product's authors actually use return today; the list is meant to grow, and a
 * miss is not a disaster — it costs one confusing failure the first time someone
 * selects the model, which is exactly the cost this list exists to reduce.
 *
 * `-audio` catches models that genuinely converse (`gpt-4o-audio-preview`), and
 * that is intended: this client speaks text and images, so an audio endpoint is
 * a failure waiting to be selected either way.
 */
const NOT_CHAT: readonly RegExp[] = [
	// Embeddings.
	/embed/, /^bge[-_]/, /^gte[-_]/, /^m3e/, /^conan[-_]/, /^jina[-_]/,
	// Rerankers and classifiers.
	/rerank/, /moderation/,
	// Speech.
	/whisper/, /(^|[-_])tts([-_]|$)/, /speech/, /sovits/, /voice/, /[-_]audio([-_]|$)/,
	// Images.
	/([-_]|^)image([-_]|$)/, /dall[-_]?e/, /midjourney/, /^mj[-_]/, /flux/,
	/stable[-_]?diffusion/, /^sdxl/, /^sd[0-9]/, /kolors/, /cogview/, /seedream/,
	/wanx/, /irag/, /recraft/, /ideogram/,
	// Video.
	/^sora/, /kling/, /^veo[-_]/, /seedance/, /runway/, /hailuo/, /^vidu/, /pixverse/,
];

/**
 * A family's defaults, applied when the id is not in `catalog.ts`.
 *
 * `test` runs against the lowercased id with any `vendor/` prefix removed, which
 * is how OpenRouter-style relays spell the same models.
 */
interface RelayFamily {
	readonly test: RegExp;
	readonly caps: Omit<BYOKModelCapabilities, 'name'>;
}

/**
 * A family earns an entry here only when the whole family agrees.
 *
 * Claude has been a 200K window across every model for years, and Gemini a 1M
 * one; assuming those is reading a family fact, not extrapolating. The
 * open-weight vendors in `catalog.ts` are deliberately absent for the opposite
 * reason: GLM's documented members range from 131K to 1M and Kimi's from 262K
 * to 1M, so there is no family number to state. A relay serving `glm-5.3` — one
 * point release newer than anything measured — therefore lands on the unknown
 * default rather than inheriting `glm-5.2`'s 1M window. That costs the author
 * prompt budget, which is the cheap way to be wrong; inheriting would cost them
 * a 400 in the relay's own dialect, which is the expensive one.
 *
 * `gpt` and `grok` sit here at the generic floor rather than above it. They are
 * listed anyway because the vision flag differs from the fallback, and because
 * an explicit entry is where a measured figure goes when someone has one.
 *
 * Vision is granted to the families where it is near-universal today and
 * withheld elsewhere. The trade is small in both directions — a wrongly granted
 * vision flag costs nothing until an author attaches an image, and a wrongly
 * withheld one only means they cannot — so it is settled on what is true of most
 * current members rather than on a worst case.
 *
 * `thinking` is left off everywhere. It is not free to claim: it changes what
 * this client expects back, and a relay fronting a model that does not reason
 * turns that into an error the author reads as "the relay is broken". Models we
 * have actually measured carry it through `DOCUMENTED` instead.
 */
const FAMILIES: readonly RelayFamily[] = [
	{
		test: /^claude[-_]/,
		caps: { contextWindow: 200_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, editTools },
	},
	{
		test: /^gemini[-_]/,
		caps: { contextWindow: 1_000_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, editTools },
	},
	{
		test: /^gemma[-_]/,
		caps: { contextWindow: 128_000, maxOutputTokens: 16_000, toolCalling: true, vision: false, editTools },
	},
	{
		test: /^(gpt|chatgpt|o[1-9])[-_.]/,
		caps: { contextWindow: 128_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, editTools },
	},
	{
		// 256K rather than the generic floor: every Grok xAI documents today is at
		// least that, so the floor could only ever be wrong in the wasteful
		// direction here. Named releases carry their real window through
		// GROK_MODELS above.
		test: /^grok[-_]/,
		caps: { contextWindow: 256_000, maxOutputTokens: 32_000, toolCalling: true, vision: true, editTools },
	},
];

/**
 * What an id nobody recognises is assumed to be.
 *
 * 128K is the smallest window in common use among models a relay bothers to
 * carry, so it is the largest figure that cannot overshoot a real one badly. The
 * output ceiling is lower still for the same reason in the other direction: a
 * refused `max_tokens` fails the request outright, while a low one only truncates
 * a reply the author can continue.
 */
const UNKNOWN: Omit<BYOKModelCapabilities, 'name'> = {
	contextWindow: 128_000,
	maxOutputTokens: 8_192,
	toolCalling: true,
	vision: false,
	editTools,
};

/**
 * Strip a relay's vendor prefix. `openai/gpt-5.4` and `gpt-5.4` are the same
 * model wearing two spellings, and only the second matches anything here.
 */
function bareId(id: string): string {
	const lower = id.toLowerCase().trim();
	const slash = lower.lastIndexOf('/');
	return slash === -1 ? lower : lower.slice(slash + 1);
}

/** Whether the listing entry is something this client could ever talk to. */
export function isChatModelId(id: string): boolean {
	const bare = bareId(id);
	return !NOT_CHAT.some(pattern => pattern.test(bare));
}

/**
 * Capabilities for one id from a relay's listing, or `undefined` to leave it out
 * of the picker.
 *
 * The id is passed through unchanged to the caller; only matching is normalised.
 */
export function relayModelCapabilities(id: string): BYOKModelCapabilities | undefined {
	const trimmed = id.trim();
	if (!trimmed) {
		return undefined;
	}
	if (!isChatModelId(trimmed)) {
		return undefined;
	}

	const bare = bareId(trimmed);

	const documented = DOCUMENTED[bare];
	if (documented) {
		return { ...documented };
	}

	const family = FAMILIES.find(candidate => candidate.test.test(bare));
	// The id is the name on purpose. A relay's own spelling is what the author
	// sees on its pricing page and in its docs, and inventing a prettier label
	// here would break the only link between the two.
	return { name: trimmed, ...(family ? family.caps : UNKNOWN) };
}
