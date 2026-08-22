/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for the open-weight BYOK vendors.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { isDeepSeekFamily, isKimiFamily, isMinimaxFamily } from '../../../platform/endpoint/common/chatModelCapabilities';
import { DEEPSEEK_MODELS, GLM_MODELS, KIMI_MODELS, MINIMAX_MODELS, QWEN_MODELS } from '../catalog';
import { DeepSeekLMProvider, KimiLMProvider, MiniMaxLMProvider, NOVEL_BYOK_PROVIDERS, QwenLMProvider } from '../providers';
import { RelayLMProvider } from '../relayProvider';

const ALL_CATALOGUES = {
	DeepSeek: DEEPSEEK_MODELS,
	Kimi: KIMI_MODELS,
	GLM: GLM_MODELS,
	Qwen: QWEN_MODELS,
	MiniMax: MINIMAX_MODELS,
};

function fakeLogService() {
	const log = {
		trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
		show: vi.fn(), createSubLogger: vi.fn(), withExtraTarget: vi.fn(),
	};
	log.createSubLogger.mockReturnValue(log);
	log.withExtraTarget.mockReturnValue(log);
	return log;
}

/** Exposes the protected surface the tests need. */
function createProvider<T>(
	Ctor: new (...args: any[]) => T,
	fetchImpl: () => Promise<unknown> = () => Promise.reject(new Error('network is down'))
): { provider: T & { getModels(silent: boolean, key?: string): Promise<any[]> }; log: ReturnType<typeof fakeLogService> } {
	const log = fakeLogService();
	const instance = new Ctor(
		{ getAPIKey: vi.fn().mockResolvedValue(undefined), storeAPIKey: vi.fn(), deleteAPIKey: vi.fn() },
		{ fetch: vi.fn().mockImplementation(fetchImpl) },
		log,
		{ createInstance: vi.fn().mockReturnValue({}) },
		{ isConfigured: vi.fn().mockReturnValue(false), getConfig: vi.fn(), setConfig: vi.fn() },
		{}
	);
	const exposed = instance as any;
	exposed.getModels = (silent: boolean, key?: string) => exposed.getAllModels(silent, key, undefined);
	return { provider: exposed, log };
}

describe('the catalogue', () => {
	it('gives every model the edit tools, or it silently rewrites whole chapters', () => {
		// A model with no editTools falls through to insert_edit_into_file alone:
		// the code-mapper path that regenerates the entire file for a one-line
		// change. There is no error when this is forgotten — only slowness.
		for (const [vendor, models] of Object.entries(ALL_CATALOGUES)) {
			for (const [id, caps] of Object.entries(models)) {
				expect(caps.editTools, `${vendor}/${id} has no editTools`).toBeTruthy();
				expect(caps.editTools!.length, `${vendor}/${id} has empty editTools`).toBeGreaterThan(0);
			}
		}
	});

	it('states a context window and an output ceiling for every model', () => {
		// maxInputTokens is derived as contextWindow - maxOutputTokens, and an
		// unstated prompt budget silently collapses to 8192 downstream — which
		// the author experiences as the assistant forgetting the manuscript.
		for (const [vendor, models] of Object.entries(ALL_CATALOGUES)) {
			for (const [id, caps] of Object.entries(models)) {
				expect(caps.contextWindow, `${vendor}/${id}`).toBeGreaterThan(0);
				expect(caps.maxOutputTokens, `${vendor}/${id}`).toBeGreaterThan(0);
				expect(caps.maxOutputTokens, `${vendor}/${id} outputs more than its whole window`)
					.toBeLessThan(caps.contextWindow!);
			}
		}
	});

	it('keeps DeepSeek marked as text-only', () => {
		// Tested, not assumed: an image_url part fails deserialization upstream
		// with a 400. Flipping this to true sends images that cannot arrive.
		for (const caps of Object.values(DEEPSEEK_MODELS)) {
			expect(caps.vision).toBe(false);
		}
	});
});

// The contract that is invisible until it breaks: a BYOK model's `family` is
// its model id, and the upstream capability predicates match on family. An id
// these predicates do not recognise loses the edit-tool tables and, for Kimi,
// the sampling fix — with nothing anywhere reporting it.
describe('model ids stay inside the upstream family predicates', () => {
	it('recognises every DeepSeek id', () => {
		for (const id of Object.keys(DEEPSEEK_MODELS)) {
			expect(isDeepSeekFamily(id), id).toBe(true);
		}
	});

	it('recognises every Kimi id', () => {
		for (const id of Object.keys(KIMI_MODELS)) {
			expect(isKimiFamily(id), id).toBe(true);
		}
	});

	it('recognises the MiniMax id', () => {
		for (const id of Object.keys(MINIMAX_MODELS)) {
			expect(isMinimaxFamily({ family: id } as any), id).toBe(true);
		}
	});
});

describe('listing models', () => {
	it('serves the catalogue when the vendor cannot be reached', async () => {
		// A throw here would surface as a vendor contributing nothing, which is
		// indistinguishable from a bad key to the one person who has to fix it.
		const { provider, log } = createProvider(DeepSeekLMProvider);
		const models = await provider.getModels(false, 'sk-something');

		expect(models.map(m => m.id).sort()).toEqual(Object.keys(DEEPSEEK_MODELS).sort());
		expect(models.every(m => m.url === 'https://api.deepseek.com/v1')).toBe(true);
		expect(log.warn).toHaveBeenCalled();
	});

	it('shows nothing before a key exists', async () => {
		const { provider } = createProvider(DeepSeekLMProvider);
		expect(await provider.getModels(true, undefined)).toEqual([]);
	});

	it('narrows the catalogue to what the key can actually reach', async () => {
		// The vendor lists one of our two models plus an embedding model. The
		// embedder must not reach a chat picker, and the model we do not know
		// about cannot be offered without capabilities.
		const { provider } = createProvider(DeepSeekLMProvider, () => Promise.resolve({
			json: () => Promise.resolve({
				data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-embedding' }],
			}),
		}));

		const models = await provider.getModels(false, 'sk-something');
		expect(models.map(m => m.id)).toEqual(['deepseek-v4-flash']);
	});
});

describe('vendor quirks', () => {
	it('pins the sampling Moonshot refuses to be sent anything but', () => {
		// Moonshot 400s on any temperature but 1 and any top_p but 0.95, and the
		// client always sends a temperature. Without this every Kimi message
		// fails; the chatEndpoint fix upstream never runs on this path.
		const { provider } = createProvider(KimiLMProvider);
		expect((provider as any).pinnedSampling()).toEqual({ temperature: 1, top_p: 0.95 });
	});

	it('leaves sampling alone for vendors that accept it', () => {
		for (const Ctor of [DeepSeekLMProvider, QwenLMProvider, MiniMaxLMProvider] as any[]) {
			const { provider } = createProvider(Ctor);
			expect((provider as any).pinnedSampling()).toBeUndefined();
		}
	});

	it('gives every vendor a distinct id', () => {
		const ids = new Set<string>();
		for (const Ctor of NOVEL_BYOK_PROVIDERS) {
			const id = (Ctor as any).providerId;
			expect(ids.has(id), `duplicate provider id ${id}`).toBe(false);
			ids.add(id);
		}
		expect(ids.size).toBe(NOVEL_BYOK_PROVIDERS.length);
	});

	it('answers at an https host the moment it is constructed, except the relay', () => {
		// A vendor that owns its host can be asked where it lives before anything
		// is configured. The relay cannot: its host is the author's to supply, and
		// answering with a placeholder would send the first request somewhere real.
		for (const Ctor of NOVEL_BYOK_PROVIDERS) {
			const { provider } = createProvider(Ctor as any);
			const base = (provider as any).getModelsBaseUrl();
			if ((Ctor as any).providerId === RelayLMProvider.providerId) {
				expect(base).toBeUndefined();
			} else {
				expect(base, (Ctor as any).providerId).toMatch(/^https:\/\//);
			}
		}
	});

	it('takes the relay host from the author once they have typed one', () => {
		const { provider } = createProvider(RelayLMProvider as any);
		expect((provider as any).getModelsBaseUrl({ url: 'https://ai.example.moe' }))
			.toBe('https://ai.example.moe/v1');
	});

	it('keeps tool calling on a relay model nothing has listed yet', () => {
		// The five table-backed vendors are handed their capabilities in the
		// constructor; the relay learns them during discovery. Before that has run
		// — a restart, with the model restored from chat.cachedLanguageModels.v2 —
		// the inherited path returns resolveModelInfo's defaults, and those say
		// tool_calls: false. The agent would then be unable to read or edit a
		// single file, silently, with nothing to connect it to.
		const { provider } = createProvider(RelayLMProvider as any);
		expect((provider as any)._knownModels).toBeUndefined();

		const info = (provider as any).getModelInfo('claude-opus-5', 'https://ai.example.moe/v1');
		expect(info.capabilities.supports.tool_calls).toBe(true);
		expect(info.capabilities.limits.max_context_window_tokens).toBe(200_000);
	});

	it('still leaves a non-chat model without capabilities', () => {
		// The same fallback must not resurrect an embedding model that the listing
		// deliberately dropped: resolveModelInfo is handed undefined and applies
		// its own defaults, rather than this inventing capabilities for it.
		const { provider } = createProvider(RelayLMProvider as any);
		const info = (provider as any).getModelInfo('bge-m3', 'https://ai.example.moe/v1');
		expect(info.capabilities.supports.tool_calls).toBe(false);
	});
});
