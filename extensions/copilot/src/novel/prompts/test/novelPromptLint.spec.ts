/*---------------------------------------------------------------------------------------------
 *  VS Novel — prompt lint gate.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * A gate, not a unit test.
 *
 * The restrictions that make this product refuse its own use case are not in one
 * place. The audit of this extension found seven paths that bypass the shared
 * safety slot: eight GPT-5 resolvers swap the class, minimax and familyH embed
 * verbatim copies in their own system prompts, the execution subagent imports
 * SafetyRules directly, panel prompts use the legacy variant, and the xtab
 * subsystem carries its own set entirely.
 *
 * Fixing the two shared classes is therefore necessary but not sufficient, and
 * an upstream merge can reintroduce any of them without anyone noticing until an
 * author is told their novel is "irrelevant to software engineering". So the
 * rule is enforced by scanning, the way a lint rule is.
 *
 * When this fails after a rebase, the fix is to route the new prompt through
 * novelRules.tsx — not to widen a pattern or add an exemption.
 */

/**
 * The agent path: what an author actually talks to in the sidebar. Everything
 * here must read as a writing assistant.
 */
const AGENT_PROMPTS = 'src/extension/prompts/node/agent';

/**
 * Prompts belonging to code-only features — commit messages, notebook editing,
 * inline code generation, the code mapper.
 *
 * They call themselves programming assistants because that is what they are.
 * The novel product disables the features that reach them (tool trimming and
 * `when` clauses), so rewriting their text would be churn against upstream for
 * no user-visible effect. If any of these ever becomes reachable, it belongs in
 * the scanned set instead of here.
 */
const CODE_FEATURE_PROMPTS = [
	'src/extension/prompts/node/codeMapper',
	'src/extension/prompts/node/devcontainer',
	'src/extension/prompts/node/git',
	'src/extension/prompts/node/inline',
	'src/extension/prompts/node/panel/editCodePrompt.tsx',
	'src/extension/prompts/node/panel/editCodePrompt2.tsx',
	'src/extension/prompts/node/panel/newNotebook.tsx',
	'src/extension/prompts/node/panel/terminal.tsx',
	'src/extension/prompts/node/panel/terminalExplain.tsx',
	'src/extension/prompts/node/panel/terminalQuickFix.tsx',
	'src/extension/prompts/node/panel/startDebugging.tsx',
	'src/extension/prompts/node/panel/newWorkspace',
	'src/extension/prompts/node/testing',
];

const NOVEL_PROMPTS = 'src/novel/prompts';

/**
 * The safety and identity classes every reachable prompt falls back to.
 *
 * Narrower than the agent path on purpose: the per-family prompts carry verbatim
 * copies of the same clauses (minimax, family H), and those are unreachable for
 * this product's catalog. These two files are not.
 */
const SHARED_PROMPT_SLOTS = 'src/extension/prompts/node/base';

interface Rule {
	readonly name: string;
	readonly pattern: RegExp;
	readonly why: string;
	/** Roots to scan. Defaults to the agent path plus our own prompts. */
	readonly roots?: string[];
}

const RULES: Rule[] = [
	{
		name: 'software-engineering scope',
		pattern: /completely irrelevant to software engineering/i,
		why: 'refuses every novel-writing request outright',
		// This one is fatal anywhere it survives, including code-only prompts:
		// an author who triggers such a prompt gets a flat refusal.
		roots: ['src/extension/prompts', NOVEL_PROMPTS],
	},
	{
		name: 'impersonal tone',
		pattern: /short and impersonal/i,
		why: 'an author discussing a scene needs a collaborator, and "impersonal" is the opposite of the register the work calls for',
	},
	{
		name: 'coding-assistant identity',
		pattern: /you are (an?|the)[^.<{]{0,40}(coding|programming)\s+(agent|assistant)/i,
		why: 'identity framing leaks into how prose is written, and it is what the model falls back on when the request is not about code',
	},
	{
		// This rule exists because the gate once passed on a sentence reading
		// "a writing agent with expert-level knowledge across genres and
		// narrative forms and software engineering tasks - this encompasses
		// debugging issues, implementing new features...". Rewriting only the
		// opening leaves a self-contradicting identity, and checking the opening
		// alone reported it as clean.
		name: 'code domain trailing a writing identity',
		pattern: /(writing (agent|assistant))[^<]{0,240}?(software engineering|debugging issues|codebase|programming language|restructuring code|code explanation)/i,
		why: 'the identity was rewritten but the sentence still describes software work, leaving a contradiction the model has to resolve on its own',
	},
	{
		// The rule above stops at the first `<`, so it sees one sentence at a
		// time. That was enough for the case it was written for and is not enough
		// in general: kimiPrompts.tsx has its identity rewritten to "expert AI
		// writing assistant" while the very next <Tag> still opens "For codebase
		// questions, gather the smallest sufficient set of relevant context" and
		// goes on to "identify the controlling code path". The gate reported it
		// clean, because the tag boundary between them hid it.
		//
		// Scoped to our own prompts rather than the whole agent path on purpose.
		// Seventeen upstream family prompts are in exactly that half-migrated
		// state, and rewriting them is explicitly out of scope — see the
		// reachability test below for why that is safe rather than merely
		// convenient. What is in scope is that the prompts *we* write are not
		// allowed to end up in the same state.
		name: 'code domain anywhere in a novel prompt',
		pattern: /software engineering|debugging issues|codebase|programming language|restructuring code|code explanation|controlling code path/i,
		why: 'a prompt this product ships must not describe software work anywhere in it, not merely in its opening sentence',
		roots: [NOVEL_PROMPTS],
	},
	{
		// Limitation A-12. An undefined external policy is the worst kind of
		// instruction to leave in: the model has to guess what it forbids, and it
		// guesses conservatively, which reads as a diffuse tightening on adult and
		// dark material rather than as a refusal anyone can point at.
		name: 'undefined external content policy',
		pattern: /Microsoft content polic/i,
		why: 'an unresolvable policy reference makes the model invent its own limits, and the tightening is invisible because nothing is ever refused outright',
		roots: [SHARED_PROMPT_SLOTS, NOVEL_PROMPTS],
	},
	{
		// Limitation A-03. The clause is kept — a writing tool still declines
		// hateful material — but "violent" and "lewd" are not categories a novel
		// can be written without. Conflict is the engine of most fiction.
		name: 'violence and sexuality as refusal categories',
		pattern: /\b(lewd|violent)\b/i,
		why: 'refusing violence and sexuality outright rules out most of the fiction this product exists to write; the rest of the clause is kept, these two words are not',
		roots: [SHARED_PROMPT_SLOTS, NOVEL_PROMPTS],
	},
	{
		// The upstream refusal list. Unlike the two words above it is a whole
		// clause, and it is the one that survives a rebase most quietly: nothing
		// about "harmful, hateful, racist, or sexist" looks code-specific, so a
		// reviewer skimming a merge has no reason to stop on it.
		//
		// As *categories to refuse* they describe the cast of most serious
		// fiction. The model cannot tell "depicts bigotry" from "is bigoted" from
		// a topic list alone, so it resolves that the safe way, and the result is
		// not a refusal anyone can point at — it is a scene that came back with
		// the teeth filed off. See NovelSafetyRules for the replacement, which
		// draws the line at depiction rather than at subject matter.
		name: 'adult subject matter as refusal categories',
		pattern: /harmful, hateful, racist,? or sexist/i,
		why: 'refusing these topics outright rules out most serious fiction, and it fails silently — the author gets a softened scene rather than a refusal',
		roots: [SHARED_PROMPT_SLOTS, NOVEL_PROMPTS],
	},
	{
		// Found in platform/chat/common/commonTypes.ts, which no prompt root
		// covers: the off-topic error told the author, verbatim in the chat, that
		// it could only help with programming questions. A refusal string is a
		// prompt as far as the reader is concerned, and it can live anywhere a
		// message is built — so this one rule scans the whole extension. The
		// pattern is narrow enough that a wide scan is safe.
		name: 'refusal that scopes the product to code',
		pattern: /only (assist|help) with [^'"`]{0,30}(programming|coding)/i,
		why: 'the author is told their novel is out of scope, in a string no prompt directory contains',
		roots: ['src'],
	},
];


/**
 * Families this product's model catalog can actually produce.
 *
 * The catalog lives on the server (`model_offerings`), so this list is a
 * restatement of it rather than a derivation. It is what makes the narrow scope
 * above defensible: a prompt no shipped model resolves to is never rendered, and
 * its text cannot reach an author.
 *
 * Every one of them resolves to Copilot's own prompt for that family — upstream's
 * for grok, kimi and gemini, the shared default for deepseek, which upstream has
 * no family for. That is the arrangement this product wants: the per-model prompt
 * engineering is the reason to be built on Copilot at all.
 */
const SHIPPED_FAMILY_PREFIXES = ['deepseek', 'grok', 'kimi', 'gemini'];

function extensionRoot(): string {
	// This file is at <ext>/src/novel/prompts/test/.
	return path.resolve(__dirname, '..', '..', '..', '..');
}

/**
 * Strip comments before matching.
 *
 * Prompt files document the phrases they deliberately avoid — including this
 * project's own novelRules.tsx, which quotes each removed clause to explain the
 * decision. Matching comment text would make the gate fire on its own rationale.
 */
function promptTextOnly(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
	if (!fs.existsSync(dir)) {
		return out;
	}
	if (fs.statSync(dir).isFile()) {
		out.push(dir);
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== 'node_modules' && entry.name !== 'test') {
				walk(full, out);
			}
		} else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

function relative(file: string): string {
	return path.relative(extensionRoot(), file).split(path.sep).join('/');
}

function isCodeFeature(rel: string): boolean {
	return CODE_FEATURE_PROMPTS.some(p => rel === p || rel.startsWith(p + '/'));
}

function filesFor(rule: Rule): string[] {
	const roots = rule.roots ?? [AGENT_PROMPTS, NOVEL_PROMPTS];
	const files = roots.flatMap(r => walk(path.join(extensionRoot(), r)));
	return files
		.map(relative)
		.filter(rel => rule.roots ? true : !isCodeFeature(rel))
		.sort();
}

describe('novel prompt lint', () => {

	it('scans a non-trivial number of prompt files', () => {
		// A path change that silently empties the scan would make every
		// assertion below pass vacuously.
		const files = filesFor(RULES[2]);
		expect(files.length).toBeGreaterThan(15);
	});

	for (const rule of RULES) {
		it(`no prompt reintroduces the ${rule.name}`, () => {
			const offenders = filesFor(rule).filter(rel => {
				const text = promptTextOnly(fs.readFileSync(path.join(extensionRoot(), rel), 'utf8'));
				return rule.pattern.test(text);
			});
			expect(
				offenders,
				`${rule.why}\nRoute the prompt through src/novel/prompts/novelRules.tsx rather than widening the pattern.`
			).toEqual([]);
		});
	}

	/**
	 * The premise the narrow scope rests on, and the shape of the fix.
	 *
	 * This test used to assert the opposite: that every shipped family resolved to
	 * a prompt *this product wrote*, because in July the upstream family prompts
	 * were still coding prompts with a writing identity pasted on top, and routing
	 * an author to one of them would have handed them an agent that assumed a
	 * repository. On 2026-08-22 those prompts were themselves rewritten for a
	 * novelist and the scan above now covers all of them, which removed the reason
	 * and left three families on a hand-written prompt for no stated cause.
	 *
	 * So the invariant is inverted. Copilot's per-family prompt must win — it is
	 * the per-model tuning this product is built on — and what this product knows
	 * and Copilot cannot must arrive appended to it, never in its place.
	 */
	it('every family this product ships keeps Copilot\'s own prompt for that family', async () => {
		const ours = new Set(
			walk(path.join(extensionRoot(), NOVEL_PROMPTS))
				.flatMap(f => [...fs.readFileSync(f, 'utf8').matchAll(/class (\w+) extends PromptElement/g)].map(m => m[1]))
		);
		expect(ours.size, 'no prompt classes found under src/novel/prompts').toBeGreaterThan(0);

		const { PromptRegistry } = await import('../../../extension/prompts/node/agent/promptRegistry');
		await import('../../../extension/prompts/node/agent/allAgentPrompts');
		const instantiationService = { createInstance: (Ctor: new () => unknown) => new Ctor() } as never;

		for (const prefix of SHIPPED_FAMILY_PREFIXES) {
			const family = `${prefix}-probe`;
			const resolved = await PromptRegistry.resolveAllCustomizations(
				instantiationService,
				{ family, model: family, name: family } as never
			);
			expect(
				[...ours],
				`${prefix}: resolves to ${resolved.SystemPrompt.name}, which this product wrote. ` +
				`Substituting a family prompt discards the per-model tuning; add to the registry's ` +
				`additive slot instead (PromptRegistry.registerAdditionalInstructions).`
			).not.toContain(resolved.SystemPrompt.name);
		}
	});

	/**
	 * The other half of the same invariant. A family prompt left intact is only
	 * correct if the product's own instructions still reach the model, and they
	 * reach it through the registry's additive slot rather than the resolver.
	 * Registration happens as an import side effect, so the failure this catches
	 * is an import quietly dropped from allAgentPrompts.ts — after which every
	 * model still answers, and none of them has heard of the story bible.
	 */
	it('the product\'s own instructions are appended for every model', async () => {
		const { PromptRegistry } = await import('../../../extension/prompts/node/agent/promptRegistry');
		await import('../../../extension/prompts/node/agent/allAgentPrompts');

		expect(
			PromptRegistry.additionalSystemInstructions.map(c => c.name),
			'nothing is registered in the additive slot: no model is told where the story bible lives'
		).toContain('NovelInstructions');
		expect(
			PromptRegistry.additionalReminderInstructions.map(c => c.name),
			'the per-turn novel reminders are not registered'
		).toContain('NovelReminderInstructions');
	});

	it('every shared safety and identity class delegates to the novel rules', () => {
		// Eight resolvers swap SafetyRulesClass for Gpt5SafetyRule and panel
		// prompts use LegacySafetyRules, so all variants must land on the same
		// content — otherwise behaviour depends on which model the author picked.
		for (const rel of [
			'src/extension/prompts/node/base/safetyRules.tsx',
			'src/extension/prompts/node/base/copilotIdentity.tsx',
		]) {
			const text = fs.readFileSync(path.join(extensionRoot(), rel), 'utf8');
			const classes = [...text.matchAll(/export class (\w+) extends PromptElement/g)].map(m => m[1]);
			expect(classes.length, `${rel} declares no prompt classes`).toBeGreaterThan(0);

			const delegations = [...text.matchAll(/return <Novel\w+ \/>;/g)].length;
			expect(
				delegations,
				`${rel}: ${classes.length} classes but only ${delegations} delegate — a variant still carries the upstream text`
			).toBe(classes.length);
		}
	});
});
