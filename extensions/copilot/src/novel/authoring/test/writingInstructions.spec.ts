/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for the writing-instructions entry point.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { COPILOT_INSTRUCTIONS_PATH } from '../../../platform/customInstructions/common/promptTypes';
import { INSTRUCTIONS_SCAFFOLD, WORKSPACE_INSTRUCTIONS_PATH } from '../writingInstructions';

describe('writing instructions', () => {
	it('writes to the file the extension actually reads', () => {
		// The one failure this command cannot survive: creating a file, opening
		// it, letting the author fill it in, and having nothing consume it. That
		// looks like the model ignoring instructions, which is unfalsifiable from
		// the author's side. If upstream renames the path, this fails here rather
		// than silently in production.
		expect(WORKSPACE_INSTRUCTIONS_PATH).toBe(COPILOT_INSTRUCTIONS_PATH);
	});

	it('is a scaffold of blanks, not prose the author has to delete', () => {
		const headings = INSTRUCTIONS_SCAFFOLD.split('\n').filter(line => line.startsWith('## '));
		expect(headings.length).toBeGreaterThanOrEqual(5);

		// Every section is a heading followed by a comment and nothing else. Prose
		// we invented would ride along on every request until someone removed it,
		// and an author cannot tell our filler from their own decisions.
		const body = INSTRUCTIONS_SCAFFOLD
			.split('\n')
			.filter(line => {
				const t = line.trim();
				return t !== '' && !t.startsWith('#') && !t.startsWith('<!--') && !t.startsWith('-->');
			});
		const outsideComments = body.filter(line => !isInsideComment(INSTRUCTIONS_SCAFFOLD, line));
		expect(outsideComments).toEqual([]);
	});

	it('tells the author the file costs them tokens on every request', () => {
		// The single most useful thing the scaffold can say. Left out, these files
		// grow without bound: there is no feedback anywhere in the product that
		// connects a long instructions file to a smaller context for the chapter.
		expect(INSTRUCTIONS_SCAFFOLD).toContain('每一次请求');
	});

	it('leaves a fillable line under the first section', () => {
		// Mirrors what firstFillableLine looks for, so the cursor placement cannot
		// silently stop working when the scaffold is reworded.
		const lines = INSTRUCTIONS_SCAFFOLD.split('\n');
		const firstHeading = lines.findIndex(line => line.startsWith('## '));
		expect(firstHeading).toBeGreaterThan(-1);
		const close = lines.findIndex((line, i) => i > firstHeading && line.trimEnd().endsWith('-->'));
		expect(close).toBeGreaterThan(firstHeading);
	});
});

/** Whether a line falls between an unterminated `<!--` and its `-->`. */
function isInsideComment(text: string, line: string): boolean {
	const at = text.indexOf(line);
	const before = text.slice(0, at);
	const opens = (before.match(/<!--/g) ?? []).length;
	const closes = (before.match(/-->/g) ?? []).length;
	return opens > closes;
}
