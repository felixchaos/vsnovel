/*---------------------------------------------------------------------------------------------
 *  VS Novel — which tools the agent may reach in a manuscript.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Tool availability is declared, not coded — every entry is a `when` clause in
 * package.json. That makes it cheap to change and equally cheap to break, since
 * nothing type-checks a context-key expression.
 *
 * The half of this file that matters is the second half. Disabling a tool the
 * agent needs does not produce an error: the model simply stops being able to do
 * something, works around it badly, and the cause is invisible from the
 * transcript. So the essential list is asserted explicitly.
 */

const DEVELOPER_TOOLS_SETTING = 'github.copilot.chat.novelBuilder.developerTools';

/** Gated: useless or harmful once the workspace is a manuscript. */
const EXPECTED_GATED = [
	'copilot_searchCodebase',
	'copilot_searchWorkspaceSymbols',
	'copilot_getVSCodeAPI',
	'copilot_findTestFiles',
	'copilot_createNewJupyterNotebook',
	'copilot_editNotebook',
	'copilot_runNotebookCell',
	'copilot_getNotebookSummary',
	'copilot_readNotebookCellOutput',
	'copilot_githubRepo',
	'copilot_githubTextSearch',
	'copilot_installExtension',
	'copilot_runVscodeCommand',
	'execution_subagent',
];

/**
 * Must stay reachable. Each of these is how the agent does the actual work of
 * writing: finding a chapter, reading it, editing it, remembering the story
 * bible, seeing what the author changed.
 *
 * `copilot_findTextInFiles` is ripgrep and works on any UTF-8 text, which is
 * what makes it the retrieval backbone while semantic search is unavailable.
 */
const MUST_REMAIN_AVAILABLE = [
	'copilot_findFiles',
	'copilot_findTextInFiles',
	// This product's own checker — the 'run the tests' half of the loop that
	// copilot_getErrors only covers passively. See novelCheckTool.tsx.
	'copilot_novelCheck',
	// Ranked retrieval over prose. copilot_searchCodebase is gated because its
	// tokenizer extracts nothing from Chinese; this is what takes its place.
	'copilot_searchManuscript',
	// The write-check-fix loop. Everything this product checks — name drift,
	// continuity, overdue foreshadowing, glossary renderings — is published as a
	// diagnostic, and this is the only tool that reads diagnostics. Gating it as
	// a "code errors" tool left the agent unable to see a single one of its own
	// findings, and the failure is silent: nothing errors, the agent simply never
	// learns it spelled a name wrong. Its modelDescription is rewritten in
	// package.json to say what it will actually find in a manuscript.
	'copilot_getErrors',
	'copilot_readFile',
	'copilot_listDirectory',
	'copilot_readProjectStructure',
	'copilot_applyPatch',
	'copilot_insertEdit',
	'copilot_createFile',
	'copilot_createDirectory',
	'copilot_replaceString',
	'copilot_multiReplaceString',
	'copilot_editFiles',
	'copilot_memory',
	'copilot_getChangedFiles',
	'copilot_fetchWebPage',
	'search_subagent',
	'explore_subagent',
];

function packageJson(): any {
	// <ext>/src/novel/tools/test/ → <ext>
	const root = path.resolve(__dirname, '..', '..', '..', '..');
	return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

/**
 * The declaration as package.json holds it. Typed loosely on purpose — the shape
 * is upstream's and adding fields to it here would be a second, drifting copy of
 * a schema this file does not own.
 */
interface DeclaredTool {
	readonly name: string;
	readonly when?: string;
	readonly modelDescription?: string;
	readonly inputSchema?: { required?: string[]; properties?: Record<string, { type?: string }> };
}

function tools(): DeclaredTool[] {
	return packageJson().contributes.languageModelTools;
}

function toolNamed(name: string) {
	const found = tools().find(t => t.name === name);
	expect(found, `no tool declared with name ${name} — it was renamed or removed upstream`).toBeDefined();
	return found!;
}

describe('developer tools are gated', () => {

	it('declares the escape hatch, defaulting to off', () => {
		// Off by default, but present: turning it on restores the full upstream
		// tool set in one setting, which is what makes this reversible rather
		// than a deletion.
		const props = packageJson().contributes.configuration.properties
			?? packageJson().contributes.configuration[0].properties;
		const setting = props[DEVELOPER_TOOLS_SETTING];
		expect(setting, `${DEVELOPER_TOOLS_SETTING} must be declared`).toBeDefined();
		expect(setting.default).toBe(false);
	});

	for (const name of EXPECTED_GATED) {
		it(`${name} requires the setting`, () => {
			const when = toolNamed(name).when ?? '';
			expect(
				when,
				`${name} is reachable by default; in a manuscript it either returns nothing or acts on something the author never asked for`
			).toContain(`config.${DEVELOPER_TOOLS_SETTING}`);
		});
	}
});

describe('the tools writing depends on stay reachable', () => {
	for (const name of MUST_REMAIN_AVAILABLE) {
		it(`${name} is not behind the developer-tools setting`, () => {
			const when = toolNamed(name).when ?? '';
			expect(
				when,
				`${name} was gated. Losing it does not raise an error — the agent just quietly stops being able to do part of its job`
			).not.toContain(DEVELOPER_TOOLS_SETTING);
		});
	}
});

describe('the gate list and the declarations agree', () => {
	it('every gated tool exists', () => {
		const declared = new Set(tools().map(t => t.name));
		const missing = EXPECTED_GATED.filter(n => !declared.has(n));
		expect(missing, 'these were renamed or removed upstream; the gate silently stopped applying').toEqual([]);
	});

	it('nothing else acquired the gate unnoticed', () => {
		// A tool gated by an upstream merge, or by someone reaching for the
		// nearest `when` clause, should be a deliberate addition to the list
		// above rather than a surprise.
		const unexpected = tools()
			.filter(t => (t.when ?? '').includes(DEVELOPER_TOOLS_SETTING))
			.map(t => t.name)
			.filter(n => !EXPECTED_GATED.includes(n));
		expect(unexpected, 'gated but not listed in EXPECTED_GATED').toEqual([]);
	});
});

describe('the manuscript checker is declared', () => {

	// The contributed name and the internal one are paired by enum *key*, not by
	// value, so a mismatch is silent: the tool is declared, never resolves, and
	// simply never gets called.
	it('uses the contributed name the enum maps to', () => {
		const declared = toolNamed('copilot_novelCheck');
		expect(declared.when).toBeUndefined();
		expect(declared.inputSchema?.properties?.filePaths.type).toBe('array');
	});

	// The description is what makes the agent reach for this rather than
	// get_errors after writing a chapter. Losing it does not break anything —
	// the tool just stops being used.
	it('tells the model when to prefer it over the problems panel', () => {
		const declared = toolNamed('copilot_novelCheck');
		expect(declared.modelDescription).toMatch(/copilot_getErrors/);
		expect(declared.modelDescription).toMatch(/after writing or editing a chapter/i);
	});
});

describe('the manuscript search is declared', () => {

	it('requires a query and offers the reveal gate', () => {
		const declared = toolNamed('copilot_searchManuscript');
		expect(declared.when).toBeUndefined();
		expect(declared.inputSchema?.required).toEqual(['query']);
		expect(declared.inputSchema?.properties?.currentChapter.type).toBe('number');
	});

	// The gate only applies when the model passes currentChapter, so the
	// description is the mechanism, not documentation of it. Losing this
	// sentence loses the spoiler protection with nothing failing.
	it('tells the model when passing currentChapter matters', () => {
		const declared = toolNamed('copilot_searchManuscript');
		expect(declared.modelDescription).toMatch(/currentChapter/);
		expect(declared.modelDescription).toMatch(/drafting or revising/i);
		expect(declared.modelDescription).toMatch(/copilot_findTextInFiles/);
	});
});
