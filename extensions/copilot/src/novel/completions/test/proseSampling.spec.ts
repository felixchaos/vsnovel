/*---------------------------------------------------------------------------------------------
 *  VS Novel — prose completion sampling.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
	getMaxSolutionTokens,
	getStops,
	getTemperatureForSamples,
} from '../../../extension/completions-core/vscode-node/lib/src/openai/openai';
import { isProseLanguage, proseMaxTokens, proseStops, proseTemperature } from '../proseSampling';

/**
 * A stand-in for the runtime-mode service. Only `isRunningInTest` is consulted
 * by the function under test, and it must report false — upstream short-circuits
 * to temperature 0 in tests, which would mask everything this file checks.
 */
const notATestRuntime = { isRunningInTest: () => false } as never;

const CODE_LANGUAGE = 'typescript';

describe('prose language detection', () => {
	it('covers the languages a manuscript is written in', () => {
		expect(isProseLanguage('markdown')).toBe(true);
		expect(isProseLanguage('plaintext')).toBe(true);
	});

	it('leaves code languages alone', () => {
		// Every change here is scoped to prose. If this ever returns true for a
		// programming language, code completion silently gets prose sampling.
		for (const id of ['typescript', 'python', 'rust', 'go', 'json']) {
			expect(isProseLanguage(id), `${id} must not be treated as prose`).toBe(false);
		}
		expect(isProseLanguage(undefined)).toBe(false);
	});
});

describe('stop sequences', () => {
	// A paragraph is to prose what a statement is to code, and `\n\n` is that
	// boundary. Not `\n\n\n`, which upstream uses for markdown and which in a
	// manuscript is a scene break — stopping there runs the suggestion to the end
	// of the scene. And not nothing at all, which was the previous answer: with no
	// stop the token limit decides the length, and the author gets eight
	// paragraphs of ghost text they cannot read at a glance.
	it('stops prose at the end of a paragraph', () => {
		expect(proseStops()).toEqual(['\n\n']);
		expect(getStops('markdown')).toEqual(['\n\n']);
		expect(getStops('plaintext')).toEqual(['\n\n']);
	});

	it('keeps code stops untouched', () => {
		expect(getStops('python')).toContain('\ndef ');
		expect(getStops(CODE_LANGUAGE)).toEqual(['\n\n\n', '\n```']);
	});
});

describe('temperature', () => {
	it('is never zero for prose', () => {
		// This is the property that matters. Upstream returns 0.0 for a single
		// completion, which is why two completions at the same cursor come back
		// identical and why the register reads flat.
		expect(proseTemperature(1)).toBeGreaterThan(0);
		expect(getTemperatureForSamples(notATestRuntime, 1, 'markdown')).toBeGreaterThan(0);
		expect(getTemperatureForSamples(notATestRuntime, 1, 'plaintext')).toBeGreaterThan(0);
	});

	it('stays inside the range where Chinese output holds together', () => {
		// Beyond roughly 1.2 the model starts losing grammatical cohesion.
		for (const n of [1, 3, 10, 25]) {
			expect(proseTemperature(n)).toBeLessThanOrEqual(1.2);
		}
	});

	it('spreads multiple samples further apart than a single suggestion', () => {
		expect(proseTemperature(3)).toBeGreaterThan(proseTemperature(1));
	});

	it('leaves code sampling deterministic', () => {
		expect(getTemperatureForSamples(notATestRuntime, 1, CODE_LANGUAGE)).toBe(0.0);
		expect(getTemperatureForSamples(notATestRuntime, 1, undefined)).toBe(0.0);
	});
});

describe('output budget', () => {
	const UPSTREAM_DEFAULT = 500;

	// This once asserted the opposite — that prose needed *more* room than
	// upstream's 500, on the reasoning that 500 tokens is about 500 Chinese
	// characters and therefore "under a paragraph". The arithmetic was right and
	// the conclusion backwards: 500 Chinese characters is several paragraphs. The
	// budget that shipped from it was 1200, and what the author saw was a page of
	// ghost text for one keystroke.
	it('holds a paragraph and not a scene', () => {
		expect(proseMaxTokens()).toBeLessThan(UPSTREAM_DEFAULT);
		expect(getMaxSolutionTokens('markdown')).toBe(proseMaxTokens());
	});

	it('stays small enough that ghost text remains readable', () => {
		// Lines after the first are rendered at a fixed 1,000,000px width
		// (ghostTextView.ts:655-658), so a long multi-line suggestion becomes an
		// unreadable horizontal strip. Roughly one paragraph is the ceiling until
		// that renderer is fixed.
		expect(proseMaxTokens()).toBeLessThanOrEqual(1500);
	});

	it('leaves the code budget at the upstream default', () => {
		expect(getMaxSolutionTokens(CODE_LANGUAGE)).toBe(UPSTREAM_DEFAULT);
		expect(getMaxSolutionTokens(undefined)).toBe(UPSTREAM_DEFAULT);
	});
});
