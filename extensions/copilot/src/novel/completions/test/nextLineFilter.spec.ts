/*---------------------------------------------------------------------------------------------
 *  VS Novel — does the duplicate-next-line filter misfire on Chinese prose?
 *--------------------------------------------------------------------------------------------*/

/**
 * An investigation, not a change.
 *
 * The audit lists this filter (limitation H-05) as misfiring often on dialogue
 * and on repeated sentence patterns. That is a claim about Chinese prose, and
 * the last time this project acted on a claim of that exact shape — that
 * repetition detection needed loosening because Chinese repeats more — the
 * change turned out to be unnecessary: six real prose patterns all passed the
 * original thresholds and the change was reverted (CLAUDE.md, 已验证过的判断).
 *
 * So this measures before anything is touched. Each case below is a pattern a
 * Chinese novel actually contains, and the assertion records what the filter
 * really does with it. If nothing here fires, there is no bug to fix and the
 * item should be closed rather than "fixed".
 */

import { describe, expect, it } from 'vitest';
import { postProcessChoiceInContext } from '../../../extension/completions-core/vscode-node/lib/src/suggestions/suggestions';

/** A document that answers the two things the filter reads. */
function documentOf(text: string) {
	const lines = text.split('\n');
	return {
		lineCount: lines.length,
		lineAt: (line: number) => ({ text: lines[line] ?? '' }),
	} as never;
}

/**
 * Every service answers every call with a no-op.
 *
 * The drop path is instrumented — it reports the filtered suggestion through
 * three telemetry surfaces before returning — and none of that is the subject
 * here. Enumerating those methods would make this test a record of the
 * telemetry shape rather than of the filter's decision.
 */
const noop: unknown = new Proxy(() => noop, {
	// Symbol keys have to answer honestly. Telemetry stringifies what it is given,
	// asynchronously, and a proxy that returns itself for Symbol.toPrimitive turns
	// that into an unhandled rejection long after the assertion has passed.
	get: (_target, key) => {
		if (typeof key === 'symbol') {
			return undefined;
		}
		return key === 'toString' || key === 'valueOf' ? () => '' : noop;
	},
	apply: () => noop,
});
const accessor = { get: () => noop } as never;
const logger = noop as never;

/**
 * Whether a suggestion survives. `undefined` from the post-processor means the
 * author never sees it — there is no other signal, which is what makes this
 * worth measuring rather than reasoning about.
 */
function survives(documentText: string, cursorLine: number, completionText: string): boolean {
	const choice = { completionText, tokens: completionText.split(''), requestId: {} } as never;
	const result = postProcessChoiceInContext(
		accessor, documentOf(documentText), { line: cursorLine, character: 0 }, choice, false, logger
	);
	return result !== undefined;
}

describe('duplicate-next-line filter on Chinese prose', () => {

	// The pattern the audit names: dialogue where a short line recurs.
	it('keeps a repeated line of dialogue that is not the very next line', () => {
		const scene = [
			'「我不去。」',
			'',                       // cursor here
			'他别过头。',
			'「我不去。」',
		].join('\n');
		expect(survives(scene, 1, '「我不去。」')).toBe(true);
	});

	// 排比 — the parallel construction that prompted the earlier false alarm.
	it('keeps a parallel construction', () => {
		const passage = [
			'风起时，他在城头。',
			'',
			'雨落时，他在渡口。',
		].join('\n');
		expect(survives(passage, 1, '雪降时，他在关外。')).toBe(true);
	});

	// A refrain repeated immediately, which is the one shape the filter does
	// catch. Recorded so the boundary is documented rather than assumed.
	it('drops a suggestion identical to the immediately following line', () => {
		const refrain = ['他没有回头。', '', '他没有回头。'].join('\n');
		expect(survives(refrain, 1, '他没有回头。')).toBe(false);
	});

	it('keeps a suggestion that merely starts like the next line', () => {
		const passage = ['', '他没有回头。'].join('\n');
		expect(survives(passage, 0, '他没有回头，只把伞往左边偏了偏。')).toBe(true);
	});

	// Ellipsis and 叠词 — long runs of one character, which is where a
	// periodicity check would be expected to misfire if anywhere.
	it('keeps ellipsis and reduplication', () => {
		expect(survives('\n他终于开口。', 0, '「我……我不知道。」')).toBe(true);
		expect(survives('\n她笑了。', 0, '雨淅淅沥沥地下着，一直下着。')).toBe(true);
	});
});
