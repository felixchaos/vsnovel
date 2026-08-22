/*---------------------------------------------------------------------------------------------
 *  VS Novel — the model catalogue for vendors an author brings their own key to.
 *--------------------------------------------------------------------------------------------*/

/**
 * What each open-weight vendor offers, stated here rather than discovered.
 *
 * The upstream BYOK providers lean on a known-models list fetched from
 * `main.vscode-cdn.net/extensions/copilotChat.json`. That file is Microsoft's,
 * it describes the models Copilot cares about, and no amount of waiting will
 * put DeepSeek or GLM in it. A provider that depends on it would ship an empty
 * picker to every author who pastes a Chinese vendor's key.
 *
 * So the table is ours. It buys three things that matter more than freshness:
 *
 * - **A key is the whole configuration.** Context window, output ceiling, tool
 *   calling, vision, thinking depth — all of it is knowable from the vendor's
 *   docs and none of it should be asked of a novelist. The alternative is what
 *   this product shipped before: a Custom Endpoint form with `maxInputTokens`
 *   and `toolCalling` fields, which is unfillable by the people it is for.
 * - **A whitelist, not just a description.** `getModelsFromEndpoint` skips any
 *   id it cannot find capabilities for, so listing a model here is what makes
 *   it appear. Every vendor's `/models` also returns embeddings, rerankers and
 *   TTS voices; none of them belong in a chat picker.
 * - **`editTools`.** Absent, a model falls through to `insert_edit_into_file`
 *   alone — the whole-file rewrite path. On a chapter that means regenerating
 *   thousands of characters to change one sentence. The three family tables in
 *   `chatModelCapabilities.ts` do not help here: those gate CAPI models, while
 *   a BYOK endpoint is read through `editToolsHint`.
 *
 * **On the numbers.** Every context window and output ceiling below is either
 * from the vendor's own documentation or measured against the live API, and the
 * source is named per entry. Where a vendor does not publish a figure it is
 * marked and a deliberately low value is used: too small only wastes budget,
 * too large is a 400 the author cannot read. None of these are guesses dressed
 * up as facts — an entry with no source says so.
 */

import type { BYOKKnownModels } from '../../extension/byok/common/byokProvider';

/**
 * The edit tools every model in this file is offered.
 *
 * All of these vendors post-train for coding agents, and string replacement is
 * the editing shape those benchmarks measure. Upstream already trusts DeepSeek,
 * Kimi and MiniMax with `replace_string` through the family tables; GLM and Qwen
 * have no upstream precedent and are marked as such on their entries.
 *
 * The asymmetry decides the doubt: a model that handles the tool badly retries
 * and recovers, while a model denied the tool rewrites the whole chapter on
 * every single edit, forever.
 */
const EDIT_TOOLS = ['find-replace', 'multi-find-replace'] as const;

/** Shared by the entries below; spelled once so a new model cannot forget it. */
const editTools = [...EDIT_TOOLS];

/**
 * DeepSeek V4 — https://api-docs.deepseek.com/quick_start/pricing
 *
 * 1M context and a 384K output ceiling are the published figures. The output
 * budget here is deliberately far below that ceiling: `maxInputTokens` is
 * derived as `contextWindow - maxOutputTokens`, so claiming the full 384K would
 * spend a third of a novel's context on an output length no chapter reaches.
 *
 * The six reasoning levels are measured, not assumed — this product re-ran the
 * ladder against the 0731 weights (n≈14 per level) and the mean is monotone
 * across all six, which is why none of them is dropped. See the table comment
 * in the server's `internal/wiring/catalog.go`.
 *
 * Vision is false because it is tested false: an `image_url` part fails
 * deserialization at the upstream with a 400.
 */
export const DEEPSEEK_MODELS: BYOKKnownModels = {
	'deepseek-v4-pro': {
		name: 'DeepSeek V4 Pro',
		contextWindow: 1_000_000,
		maxOutputTokens: 65_536,
		toolCalling: true,
		vision: false,
		thinking: true,
		supportsReasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
		editTools,
	},
	'deepseek-v4-flash': {
		name: 'DeepSeek V4 Flash',
		contextWindow: 1_000_000,
		maxOutputTokens: 65_536,
		toolCalling: true,
		vision: false,
		thinking: true,
		supportsReasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
		editTools,
	},
};

/**
 * Moonshot / Kimi — https://platform.kimi.ai/docs/api/chat
 *
 * K3's 1,048,576-token window is documented. The K2 entries' windows are not
 * published anywhere we can cite, so they take the conservative 256K that the
 * K2 generation is generally offered at; an author who hits that ceiling loses
 * nothing but headroom, and the figure is one live request away from being
 * corrected once someone holds a Moonshot key.
 *
 * Only ids that `isKimiFamily` already recognises are listed. That predicate
 * gates the edit-tool tables, and — more importantly — this vendor 400s on any
 * `temperature` but 1 and any `top_p` but 0.95, which the provider pins.
 * `kimi-k2.5` is deliberately absent: it matches neither the predicate nor
 * anything this product has run.
 */
export const KIMI_MODELS: BYOKKnownModels = {
	'kimi-k3': {
		name: 'Kimi K3',
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
	'kimi-k2.7-code': {
		// Context not published by Moonshot; 256K is the conservative floor.
		name: 'Kimi K2.7 Code',
		contextWindow: 262_144,
		maxOutputTokens: 32_768,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
	'kimi-k2.6': {
		// Context not published by Moonshot; 256K is the conservative floor.
		name: 'Kimi K2.6',
		contextWindow: 262_144,
		maxOutputTokens: 32_768,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
};

/**
 * Zhipu GLM — https://docs.bigmodel.cn, model ids read from the chat-completions
 * OpenAPI spec (they are lowercase in the API even though the docs print them
 * as `GLM-5.2`).
 *
 * Context and output figures are the published ones. The catalogue is trimmed
 * to the text and vision models an author would write with: `charglm`, `emohaa`,
 * `glm-4-voice` and `autoglm-phone` serve role-play, audio and phone-agent
 * products that have nothing to do with a manuscript.
 *
 * GLM has no upstream family predicate, so its edit-tool support rests on the
 * same reasoning as the rest of this file rather than on a precedent.
 */
export const GLM_MODELS: BYOKKnownModels = {
	'glm-5.2': {
		name: 'GLM-5.2',
		contextWindow: 1_000_000,
		maxOutputTokens: 131_072,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
	'glm-5.1': {
		name: 'GLM-5.1',
		contextWindow: 204_800,
		maxOutputTokens: 131_072,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
	'glm-5': {
		name: 'GLM-5',
		contextWindow: 204_800,
		maxOutputTokens: 131_072,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
	'glm-5-turbo': {
		name: 'GLM-5 Turbo',
		contextWindow: 204_800,
		maxOutputTokens: 131_072,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
	'glm-4.7': {
		name: 'GLM-4.7',
		contextWindow: 204_800,
		maxOutputTokens: 131_072,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
	'glm-4.6': {
		name: 'GLM-4.6',
		contextWindow: 204_800,
		maxOutputTokens: 131_072,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
	'glm-5v-turbo': {
		name: 'GLM-5V Turbo',
		contextWindow: 204_800,
		maxOutputTokens: 131_072,
		toolCalling: true,
		vision: true,
		thinking: true,
		editTools,
	},
	'glm-4.6v': {
		name: 'GLM-4.6V',
		contextWindow: 131_072,
		maxOutputTokens: 32_768,
		toolCalling: true,
		vision: true,
		thinking: true,
		editTools,
	},
};

/**
 * Alibaba Qwen — https://help.aliyun.com/zh/model-studio
 *
 * The weakest entries in this file, and marked so. Alibaba's model-studio pages
 * name the ids and say which are multimodal, but publish neither context window
 * nor output ceiling anywhere we could read, so both figures are floors rather
 * than facts: 128K in and 8K out, which every model in this generation clears.
 * An author who brings a Qwen key gets a working picker and less headroom than
 * they paid for, until someone with a key measures the real numbers.
 */
export const QWEN_MODELS: BYOKKnownModels = {
	'qwen3.8-max': {
		// Documented as multimodal; context and output are unpublished floors.
		name: 'Qwen3.8 Max',
		contextWindow: 131_072,
		maxOutputTokens: 8_192,
		toolCalling: true,
		vision: true,
		thinking: true,
		editTools,
	},
	'qwen3.7-plus': {
		// Context and output are unpublished floors.
		name: 'Qwen3.7 Plus',
		contextWindow: 131_072,
		maxOutputTokens: 8_192,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
	'qwen3.7-flash': {
		// Context and output are unpublished floors.
		name: 'Qwen3.7 Flash',
		contextWindow: 131_072,
		maxOutputTokens: 8_192,
		toolCalling: true,
		vision: false,
		thinking: true,
		editTools,
	},
};

/**
 * MiniMax — https://platform.minimax.io/docs/guides/text-generation
 *
 * One model, and the id is mixed-case (`MiniMax-M3`) where every other vendor
 * here is lowercase — worth stating, because the picker matches on it exactly.
 * The 1M window and the image input are both documented; upstream already
 * recognises this family for the edit-tool tables.
 */
export const MINIMAX_MODELS: BYOKKnownModels = {
	'MiniMax-M3': {
		name: 'MiniMax M3',
		contextWindow: 1_000_000,
		maxOutputTokens: 65_536,
		toolCalling: true,
		vision: true,
		thinking: true,
		editTools,
	},
};
