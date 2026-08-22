/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for the relay vendor.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DEEPSEEK_MODELS, GLM_MODELS, KIMI_MODELS, MINIMAX_MODELS } from '../catalog';
import { isChatModelId, relayModelCapabilities } from '../relayCatalog';
import { normalizeRelayBaseUrl } from '../relayProvider';

/**
 * The listing one real relay returns, taken from its public `/api/pricing` on
 * 2026-08-22. Kept verbatim rather than trimmed to the interesting cases: the
 * point of these tests is what happens to a whole listing nobody curated, and a
 * hand-picked subset would stop being that the moment it was picked.
 */
const LIVE_LISTING = [
	'bge-m3', 'claude-fable-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-6',
	'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-4-6',
	'claude-sonnet-5', 'composer-2.5', 'deepseek-v4-flash', 'deepseek-v4-pro',
	'gemini-3.1-flash-image', 'gemini-3.1-pro-preview', 'gemini-3.5-flash',
	'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.7-flash',
	'gemma-4-31b-it', 'glm-5.3', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5',
	'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'grok-4.5', 'grok-4.6',
	'kimi-k3', 'mimo-v2.5-pro', 'minimax-m3', 'ox-alpha',
];

describe('relay listing triage', () => {
	it('drops the two entries in the live listing that are not chat models', () => {
		const dropped = LIVE_LISTING.filter(id => !relayModelCapabilities(id));
		expect(dropped).toEqual(['bge-m3', 'gemini-3.1-flash-image']);
	});

	it('keeps every other model in the live listing', () => {
		const kept = LIVE_LISTING.filter(id => relayModelCapabilities(id));
		expect(kept).toHaveLength(LIVE_LISTING.length - 2);
	});

	it.each([
		'text-embedding-3-large', 'bge-large-zh', 'gte-rerank', 'jina-embeddings-v3',
		'bce-reranker-base', 'omni-moderation-latest', 'whisper-1', 'tts-1-hd',
		'dall-e-3', 'gpt-image-1', 'flux-kontext-pro', 'stable-diffusion-3.5',
		'midjourney-v7', 'cogview-4', 'seedream-4.0', 'sora-2', 'kling-v2',
		'veo-3.1', 'gpt-4o-audio-preview',
	])('leaves %s out of the picker', id => {
		expect(relayModelCapabilities(id)).toBeUndefined();
		expect(isChatModelId(id)).toBe(false);
	});

	it.each([
		'gpt-5.6-terra', 'claude-opus-5', 'gemini-3.7-flash', 'grok-4.6',
		'deepseek-v4-pro', 'kimi-k3', 'glm-5.3', 'minimax-m3', 'ox-alpha',
		'qwen3-max', 'composer-2.5', 'mimo-v2.5-pro',
	])('keeps %s', id => {
		expect(relayModelCapabilities(id)).toBeDefined();
	});

	it('does not mistake a chat model for an image model on the word alone', () => {
		// The guard is on `image` as its own segment. A model whose name merely
		// contains the letters — or a vision model named for what it reads — must
		// survive, or the picker quietly loses the models an author most wants.
		expect(isChatModelId('qwen-vl-max')).toBe(true);
		expect(isChatModelId('glm-4.6v')).toBe(true);
		expect(isChatModelId('imagen-reasoner')).toBe(true);
	});
});

describe('relay capabilities', () => {
	it('reuses the documented entry when the relay serves a model we measured', () => {
		// The whole point of the exact-match branch: a relay's `deepseek-v4-pro`
		// keeps the 1M window and the six reasoning levels rather than falling
		// back to the 128K default.
		expect(relayModelCapabilities('deepseek-v4-pro')).toEqual(DEEPSEEK_MODELS['deepseek-v4-pro']);
		expect(relayModelCapabilities('kimi-k3')).toEqual(KIMI_MODELS['kimi-k3']);
		expect(relayModelCapabilities('glm-5.2')).toEqual(GLM_MODELS['glm-5.2']);
	});

	it('matches a documented id the relay spells in a different case', () => {
		// This is not hypothetical. `catalog.ts` spells MiniMax's model the way
		// MiniMax does, `MiniMax-M3`; the live relay lists `minimax-m3`. The first
		// version of this file lowercased only the query, so the two never met and
		// a 1M model silently became a 128K one.
		expect(relayModelCapabilities('minimax-m3')).toEqual(MINIMAX_MODELS['MiniMax-M3']);
		expect(relayModelCapabilities('MINIMAX-M3')).toEqual(MINIMAX_MODELS['MiniMax-M3']);
	});

	it('does not lend a documented sibling\'s window to a newer point release', () => {
		// `glm-5.3` is one release past anything measured, and GLM's documented
		// members span 131K to 1M — there is no family number to inherit. Landing
		// on the floor wastes budget; inheriting glm-5.2's 1M would produce a 400.
		expect(GLM_MODELS['glm-5.3']).toBeUndefined();
		expect(relayModelCapabilities('glm-5.3')?.contextWindow).toBe(128_000);
	});

	it('hands back a copy, so one relay cannot edit the shared catalogue', () => {
		const caps = relayModelCapabilities('deepseek-v4-pro')!;
		caps.maxOutputTokens = 1;
		expect(DEEPSEEK_MODELS['deepseek-v4-pro'].maxOutputTokens).not.toBe(1);
	});

	it('matches an OpenRouter-style vendor prefix against the same tables', () => {
		expect(relayModelCapabilities('deepseek/deepseek-v4-pro'))
			.toEqual(DEEPSEEK_MODELS['deepseek-v4-pro']);
		expect(relayModelCapabilities('ANTHROPIC/Claude-Opus-5')?.contextWindow).toBe(200_000);
	});

	it('keeps the relay spelling as the display name for models it invents', () => {
		// The author reads this name next to the relay's own pricing page; a
		// prettified label would break the only link between the two.
		expect(relayModelCapabilities('ox-alpha')?.name).toBe('ox-alpha');
		expect(relayModelCapabilities('openai/gpt-5.6-sol')?.name).toBe('openai/gpt-5.6-sol');
	});

	it('gives every model string replacement', () => {
		// Denying it is not a smaller mistake than granting it: the model then
		// rewrites the whole chapter to change one sentence, on every edit.
		for (const id of LIVE_LISTING) {
			const caps = relayModelCapabilities(id);
			if (caps) {
				expect(caps.editTools, id).toContain('find-replace');
			}
		}
	});

	it('never claims thinking for a model it only guessed at', () => {
		// Claiming it changes what this client expects back, and a relay fronting
		// a model that does not reason turns that into an error the author reads
		// as "the relay is broken".
		for (const id of ['gpt-5.6-sol', 'claude-opus-5', 'grok-4.6', 'ox-alpha']) {
			expect(relayModelCapabilities(id)?.thinking, id).toBeFalsy();
		}
		// Measured ones still carry it.
		expect(relayModelCapabilities('deepseek-v4-pro')?.thinking).toBe(true);
	});

	it('leaves room for output inside every window it assumes', () => {
		// maxInputTokens is derived as contextWindow - maxOutputTokens, so a
		// ceiling at or above the window would hand the prompt a negative budget.
		for (const id of LIVE_LISTING) {
			const caps = relayModelCapabilities(id);
			if (caps?.contextWindow) {
				expect(caps.maxOutputTokens, id).toBeLessThan(caps.contextWindow);
			}
		}
	});

	it('falls back conservatively for an id from nowhere', () => {
		const caps = relayModelCapabilities('some-relay-private-build')!;
		expect(caps.contextWindow).toBe(128_000);
		expect(caps.maxOutputTokens).toBe(8_192);
		expect(caps.toolCalling).toBe(true);
		expect(caps.vision).toBe(false);
	});

	it('ignores blank and whitespace ids', () => {
		expect(relayModelCapabilities('')).toBeUndefined();
		expect(relayModelCapabilities('   ')).toBeUndefined();
	});
});

describe('relay base URL', () => {
	it.each([
		['https://ai.example.moe/v1', 'https://ai.example.moe/v1'],
		['https://ai.example.moe', 'https://ai.example.moe/v1'],
		['https://ai.example.moe/', 'https://ai.example.moe/v1'],
		['  https://ai.example.moe/v1/  ', 'https://ai.example.moe/v1'],
		['https://ai.example.moe/v2', 'https://ai.example.moe/v2'],
	])('%s → %s', (input, expected) => {
		expect(normalizeRelayBaseUrl(input)).toBe(expected);
	});

	it('cuts an API path back off, rather than appending a second one', () => {
		// Relays document the full endpoint as often as the base, and the caller
		// appends `/chat/completions` itself. Left alone this posts to
		// `.../chat/completions/chat/completions` and 404s.
		expect(normalizeRelayBaseUrl('https://ai.example.moe/v1/chat/completions'))
			.toBe('https://ai.example.moe/v1');
		expect(normalizeRelayBaseUrl('https://ai.example.moe/v1/responses'))
			.toBe('https://ai.example.moe/v1');
	});

	it('is undefined until the author has typed something', () => {
		// The pre-configuration state has to be quiet: the base class answers with
		// an empty model list, instead of fetching from somewhere real.
		expect(normalizeRelayBaseUrl(undefined)).toBeUndefined();
		expect(normalizeRelayBaseUrl('')).toBeUndefined();
		expect(normalizeRelayBaseUrl('   ')).toBeUndefined();
	});
});
