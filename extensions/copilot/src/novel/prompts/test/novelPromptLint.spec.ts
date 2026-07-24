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
 * All three resolve to the one shared writing prompt. Grok and Kimi are the
 * families upstream also claims — by predicate — so their entries here double as
 * proof that our resolvers win that race; the dedicated grokPrompt.spec.ts and
 * kimiPrompt.spec.ts check it directly.
 */
const SHIPPED_FAMILY_PREFIXES = ['deepseek', 'grok', 'kimi'];

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
	 * The premise the narrow scope rests on.
	 *
	 * The upstream family prompts are left half-migrated — a writing identity over
	 * a body that still discusses codebases — and that is tolerable only for as
	 * long as no shipped model resolves to one of them. This checks the premise
	 * instead of assuming it, so adding a model family to the catalog without
	 * writing a prompt for it fails here rather than shipping a coding agent to an
	 * author.
	 */
	it('every family this product ships resolves to a prompt written for it', async () => {
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
				`${prefix}: resolves to ${resolved.SystemPrompt.name}, which this product did not write`
			).toContain(resolved.SystemPrompt.name);
		}
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
