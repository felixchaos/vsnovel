/*---------------------------------------------------------------------------------------------
 *  VS Novel — the shared writing prompt says how the agent should work.
 *--------------------------------------------------------------------------------------------*/

/**
 * The prompt is half of two mechanisms, and the half that fails silently.
 *
 * The reveal gate only engages when the model passes the chapter it is drafting,
 * and the checking loop only runs when the model calls the check. Both are stated
 * in the tool descriptions — locked by toolGating.spec.ts — and both are stated
 * here. Losing either wording breaks nothing: the tool still exists, the model
 * simply stops using it that way.
 *
 * Every shipped family resolves to this one prompt (deepseek, grok, kimi), so
 * these assertions cover all of them at once.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '..', 'novelWritingAgentPrompt.tsx'), 'utf8');
// Comments in this file discuss the same phrases; matching them would let the
// gate pass on a prompt whose rationale survived but whose text did not.
const prompt = source.replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('the shared writing prompt tells the agent how to work', () => {

	it('says where the work lives, rather than assuming it was handed over', () => {
		expect(prompt).toMatch(/\.novel\//);
		expect(prompt).toMatch(/story bible/i);
	});

	it('distinguishes exact search from ranked search', () => {
		expect(prompt).toMatch(/exact text/i);
		expect(prompt).toMatch(/ranked manuscript search/i);
	});

	// Without this sentence the gate never engages and nothing reports that.
	it('tells it to state the chapter when drafting', () => {
		expect(prompt).toMatch(/drafting or revising a particular chapter, say which one/i);
		expect(prompt).toMatch(/withhold everything from later chapters/i);
	});

	// The observed failure this answers: asked to strip a character across the
	// workspace, the agent wrote a Python script and ran it. Sweeping the whole
	// work that way is fine — what it must not do is revise a passage that way,
	// because the author then never sees the change as something to accept.
	it('sends passage-level changes through the editing tools', () => {
		expect(prompt).toMatch(/To change a particular line or passage, use the editing tools/i);
		expect(prompt).toMatch(/accept or reject/i);
	});

	// The boundary the authoring commands already draw, restated for the agent:
	// what the prose states is extractable, what the author intends is not.
	it('lets it record what the prose states, not what it guesses', () => {
		expect(prompt).toMatch(/Record what the prose now states/i);
		expect(prompt).toMatch(/only the author knows/i);
	});

	it('tells it to check after writing', () => {
		expect(prompt).toMatch(/run the manuscript check/i);
		expect(prompt).toMatch(/failing test/i);
	});
});
