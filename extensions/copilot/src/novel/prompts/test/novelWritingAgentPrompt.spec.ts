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

describe('the shared writing prompt tells the agent how to hold a turn', () => {

	// Observed 2026-08-01, Kimi K3 in agent mode: it wrote its questions into
	// the reply as prose, which ends the turn and waits. The tool renders them
	// as choices and returns the answer inside the same turn. Nothing else in
	// the prompt chain mentions the tool — upstream's family prompts do not
	// either — so this sentence is the only thing that asks for it.
	it('asks for the question tool rather than a question written into the reply', () => {
		expect(prompt).toMatch(/CoreAskQuestions/);
		expect(prompt).toMatch(/rather than writing the question into your reply/i);
	});

	// The same session: one step per turn, each ending in a progress report.
	// The prompt had an anti-looping rule and nothing on the other side of it.
	it('tells it to finish the request instead of reporting after every step', () => {
		expect(prompt).toMatch(/Finish what was asked before handing the turn back/i);
		expect(prompt).toMatch(/Do not ask the author to confirm something you can establish yourself/i);
	});

	// Upstream's per-family prompts all carry these; the shared prompt was
	// written without them, so every shipped model lost them at once.
	it('carries the tool-use basics upstream states for every family', () => {
		expect(prompt).toMatch(/Do not ask permission to use a tool/i);
		expect(prompt).toMatch(/never name one to the author/i);
		expect(prompt).toMatch(/absolute/i);
	});

	// The failure this answers: a model that "edits" by printing the revised
	// chapter into the chat, which reaches the author as text they cannot
	// accept, reject, or undo.
	it('states that printing prose is not an edit', () => {
		expect(prompt).toMatch(/Never print the revised prose in your reply as a substitute for editing/i);
		expect(prompt).toMatch(/Read a passage before you change it/i);
	});
});

// The reminder slot renders immediately before the author's message on every
// turn. The system prompt is read once and then buried under forty turns of
// manuscript, which is why the two behaviours that kept slipping are repeated
// here rather than only stated up top.
describe('the reminder slot repeats what keeps slipping', () => {
	const reminder = fs.readFileSync(path.resolve(__dirname, '..', 'novelReminderInstructions.tsx'), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ');

	it('names the question tool and says what asking in prose costs', () => {
		expect(reminder).toMatch(/CoreAskQuestions/);
		expect(reminder).toMatch(/ends the turn/i);
	});

	it('tells it to carry on rather than report after one step', () => {
		expect(reminder).toMatch(/carry on to the end of what was asked/i);
	});

	// Upstream put the edit-tool wording in this slot. Replacing the class
	// without carrying it forward would silently drop it for every model.
	it('keeps the upstream editing reminder', () => {
		expect(reminder).toMatch(/getEditingReminder\(/);
	});
});

// Asked 2026-08-01 why web search never fires: there is no web search. The
// product ships fetch_webpage (open a URL, locally) and nothing that finds a
// URL, and the prompt mentioned neither — so a pasted link was answered from
// memory. Saying what the tool cannot do is the point: an invented detail is
// what a research question exists to avoid.
describe('the shared writing prompt is honest about looking things up', () => {
	it('offers the page fetch and denies search in the same breath', () => {
		expect(prompt).toMatch(/FetchWebPage/);
		expect(prompt).toMatch(/There is no search/i);
		expect(prompt).toMatch(/rather than writing from memory/i);
	});

	it('keeps fetched text out of the manuscript', () => {
		expect(prompt).toMatch(/reference material, never prose/i);
	});
});
