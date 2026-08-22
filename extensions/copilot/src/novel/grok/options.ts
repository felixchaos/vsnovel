/*---------------------------------------------------------------------------------------------
 *  VS Novel — the model and thinking-depth pickers for a Grok session.
 *--------------------------------------------------------------------------------------------*/

/**
 * Turns what the agent reports about itself into the two pickers the chat input
 * shows, and turns a change back into the request that applies it.
 *
 * Every shape here was measured against `grok 1.0.5` rather than read off a
 * spec, because the parts that matter are in `_meta` and no document describes
 * them:
 *
 * - `session/new` answers with `models.currentModelId` and
 *   `models.availableModels`, each carrying its own ladder at
 *   `_meta.reasoningEfforts` — and the ladders differ per model (grok-4.6 has
 *   four rungs, grok-4.5 has three). A single shared list would offer an
 *   author a depth their model does not have.
 * - A change is applied with `session/set_model`, and the depth rides along as
 *   `_meta.reasoningEffort` on the *same* request (the agent parses it with
 *   `parse_reasoning_effort_meta`). There is no separate method for it, which
 *   is the thing that would have taken longest to guess.
 */

/** Group ids. These are the keys the editor reports selections back under. */
export const MODEL_GROUP = 'models';
export const EFFORT_GROUP = 'reasoningEffort';

/** One rung of a model's thinking ladder, as the agent describes it. */
export interface GrokReasoningEffort {
	readonly id: string;
	readonly label?: string;
	readonly description?: string;
	readonly default?: boolean;
}

/** A model the agent offers, with the ladder that belongs to it. */
export interface GrokModelOption {
	readonly modelId: string;
	readonly name: string;
	readonly description?: string;
	readonly efforts: readonly GrokReasoningEffort[];
}

/** Everything `session/new` said about models, in the shape this module uses. */
export interface GrokModelCatalogue {
	readonly current?: string;
	readonly models: readonly GrokModelOption[];
}

interface RawModel {
	modelId?: string;
	name?: string;
	description?: string;
	_meta?: {
		reasoningEfforts?: Array<{ id?: string; value?: string; label?: string; description?: string; default?: boolean }>;
	};
}

/**
 * Read the catalogue out of a `session/new` response.
 *
 * Tolerant by construction: a model with no ladder simply has no depth picker,
 * and a malformed entry is dropped rather than allowed to break the session
 * that is otherwise working.
 */
export function readCatalogue(models: unknown): GrokModelCatalogue {
	const raw = models as { currentModelId?: string; availableModels?: RawModel[] } | undefined;
	const list = Array.isArray(raw?.availableModels) ? raw.availableModels : [];
	return {
		current: raw?.currentModelId,
		models: list.flatMap(model => {
			if (!model?.modelId) {
				return [];
			}
			const efforts = (model._meta?.reasoningEfforts ?? []).flatMap(effort => {
				const id = effort?.id ?? effort?.value;
				return id ? [{ id, label: effort.label, description: effort.description, default: effort.default }] : [];
			});
			return [{
				modelId: model.modelId,
				name: model.name ?? model.modelId,
				description: model.description,
				efforts,
			}];
		}),
	};
}

/** The ladder belonging to a model, or empty when it has none. */
export function effortsFor(catalogue: GrokModelCatalogue, modelId: string | undefined): readonly GrokReasoningEffort[] {
	return catalogue.models.find(model => model.modelId === modelId)?.efforts ?? [];
}

/** The rung the agent marks as its default, for a model the author has not chosen one on. */
export function defaultEffort(efforts: readonly GrokReasoningEffort[]): string | undefined {
	return (efforts.find(effort => effort.default) ?? efforts[0])?.id;
}

/**
 * The `session/set_model` params that apply a selection.
 *
 * The depth is omitted rather than sent as null when unset: the agent resets to
 * the model's own default when `_meta` carries no `reasoningEffort`, and an
 * explicit null is not the same thing.
 */
export function setModelParams(sessionId: string, modelId: string, effort?: string): Record<string, unknown> {
	const params: Record<string, unknown> = { sessionId, modelId };
	if (effort) {
		params._meta = { reasoningEffort: effort };
	}
	return params;
}
