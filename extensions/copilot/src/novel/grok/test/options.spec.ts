/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for the Grok model / thinking-depth options.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { defaultEffort, effortsFor, readCatalogue, setModelParams } from '../options';

/** Exactly what `grok 1.0.5` answered `session/new` with. */
const REAL = {
	currentModelId: 'grok-4.6',
	availableModels: [
		{
			modelId: 'grok-4.6', name: 'Grok 4.6', description: "SpaceXAI's latest frontier model",
			_meta: {
				reasoningEfforts: [
					{ id: 'xhigh', value: 'xhigh', label: 'Extra High Effort', default: false },
					{ id: 'high', value: 'high', label: 'High Effort', default: true },
					{ id: 'medium', value: 'medium', label: 'Medium Effort', default: false },
					{ id: 'low', value: 'low', label: 'Low Effort', default: false },
				],
			},
		},
		{
			modelId: 'grok-4.5', name: 'Grok 4.5',
			_meta: {
				reasoningEfforts: [
					{ id: 'high', value: 'high', label: 'High Effort', default: true },
					{ id: 'medium', value: 'medium', label: 'Medium Effort' },
					{ id: 'low', value: 'low', label: 'Low Effort' },
				],
			},
		},
	],
};

describe('reading the catalogue', () => {
	it('takes both models and the current one', () => {
		const catalogue = readCatalogue(REAL);
		expect(catalogue.current).toBe('grok-4.6');
		expect(catalogue.models.map(m => m.modelId)).toEqual(['grok-4.6', 'grok-4.5']);
	});

	it('keeps each ladder with its own model', () => {
		// The ladders differ — grok-4.6 has four rungs and grok-4.5 has three.
		// One shared list would offer a depth the selected model does not have.
		const catalogue = readCatalogue(REAL);
		expect(effortsFor(catalogue, 'grok-4.6').map(e => e.id)).toEqual(['xhigh', 'high', 'medium', 'low']);
		expect(effortsFor(catalogue, 'grok-4.5').map(e => e.id)).toEqual(['high', 'medium', 'low']);
	});

	it('survives an agent that reports nothing useful', () => {
		// A session that works must not be broken by a malformed catalogue.
		for (const bad of [undefined, {}, { availableModels: 'nope' }, { availableModels: [{}, { name: 'no id' }] }]) {
			expect(readCatalogue(bad).models).toEqual([]);
		}
	});

	it('keeps a model that has no ladder at all', () => {
		const catalogue = readCatalogue({ availableModels: [{ modelId: 'plain', name: 'Plain' }] });
		expect(catalogue.models.map(m => m.modelId)).toEqual(['plain']);
		expect(effortsFor(catalogue, 'plain')).toEqual([]);
	});
});

describe('the default rung', () => {
	it('takes the one the agent marks', () => {
		expect(defaultEffort(effortsFor(readCatalogue(REAL), 'grok-4.6'))).toBe('high');
	});

	it('falls back to the first when none is marked', () => {
		expect(defaultEffort([{ id: 'only' }])).toBe('only');
	});

	it('has nothing to offer for a model with no ladder', () => {
		expect(defaultEffort([])).toBeUndefined();
	});
});

describe('applying a selection', () => {
	it('sends the depth on the same request as the model', () => {
		// There is no separate method for it: the agent parses `_meta.reasoningEffort`
		// off `session/set_model` itself.
		expect(setModelParams('sess-1', 'grok-4.6', 'low')).toEqual({
			sessionId: 'sess-1', modelId: 'grok-4.6', _meta: { reasoningEffort: 'low' },
		});
	});

	it('omits the depth rather than sending an empty one', () => {
		// Absent `_meta` resets the model to its own default. An explicit null
		// is not the same request and is not what the agent parses.
		expect(setModelParams('sess-1', 'grok-4.6')).toEqual({ sessionId: 'sess-1', modelId: 'grok-4.6' });
	});
});
