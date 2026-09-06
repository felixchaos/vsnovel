/*---------------------------------------------------------------------------------------------
 *  VS Novel — what the inline-completion prompt actually contains for a manuscript.
 *--------------------------------------------------------------------------------------------*/

/**
 * These assertions are on the rendered prompt rather than on any component,
 * because the prompt is the thing that was wrong. The failure they lock down was
 * reported as "the completion writes a scene in my character sheet", and it was
 * not the model misbehaving: the prompt handed it a diff of the chapter edited a
 * minute earlier, sitting between the file's own text and the caret. Measured
 * against the real service, same model and sampling, the character sheet's last
 * line being `样貌：身高158cm，`:
 *
 *   with the recent-edits block   「你明知道我会来。」我松开怀表…   3 of 3 continued the chapter
 *   without it                    有些苍白的脸，眼尾微微下垂…        3 of 3 continued the field
 *
 * The second thing checked here is the path marker. It is the one line that
 * tells the model what kind of document it is completing — chapter or character
 * sheet — and it was arriving percent-encoded, which for a Chinese or Japanese
 * manuscript means the whole path.
 */

import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

// The shared vscode shim does not define this enum, and the extension's testing
// service graph reads it at import time. Nothing under test touches it; without
// it the graph cannot be built from vitest at all.
((vscode as Record<string, unknown>).ChatEditingSessionActionOutcome ??= { Accepted: 1, Rejected: 2, Saved: 3 });

const CHAPTER = [
	'# 第十二章 档案馆',
	'',
	'怀表攥在手心，银壳边缘的缺口硌着掌纹。我靠着档案馆二楼的窗框，看楼下庭院里新栽的月桂树苗被风压弯了腰。',
	'',
	'「你还是来了。」她说。',
].join('\n');

const SHEET = [
	'# 角色设定',
	'',
	'魔法道具：',
	'缺角银怀表：指针早停了，缺的那一角摸着发涩。',
	'服装：',
	'样貌：身高158cm，',
].join('\n');

const CODE = ['function hello() {', '\treturn "world";', '}', ''].join('\n');

type Rendered = { prefix: string; suffix: string };

/**
 * Builds the prompt the way the editor does: the components factory, the
 * default ordering, and a workspace in which another file was just edited.
 */
async function promptFor(opts: {
	languageId: string;
	uri: string;
	text: string;
	editedUri: string;
	editedBefore: string;
	editedAfter: string;
}): Promise<Rendered> {
	const { MutableObservableWorkspace } = await import('../../../platform/inlineEdits/common/observableWorkspace');
	const { IInstantiationService } = await import('../../../util/vs/platform/instantiation/common/instantiation');
	const { ICompletionsObservableWorkspace } = await import('../../../extension/completions-core/vscode-node/lib/src/completionsObservableWorkspace');
	const { createCompletionState } = await import('../../../extension/completions-core/vscode-node/lib/src/completionState');
	const { TelemetryWithExp } = await import('../../../extension/completions-core/vscode-node/lib/src/telemetry');
	const { createLibTestingContext } = await import('../../../extension/completions-core/vscode-node/lib/src/test/context');
	const { ICompletionsTextDocumentManagerService } = await import('../../../extension/completions-core/vscode-node/lib/src/textDocumentManager');
	const { TestComponentsCompletionsPromptFactory } = await import('../../../extension/completions-core/vscode-node/lib/src/prompt/completionsPromptFactory/componentsCompletionsPromptFactory');
	const { ICompletionsContextProviderBridgeService } = await import('../../../extension/completions-core/vscode-node/lib/src/prompt/components/contextProviderBridge');
	const { FullRecentEditsProvider, ICompletionsRecentEditsProviderService } = await import('../../../extension/completions-core/vscode-node/lib/src/prompt/recentEdits/recentEditsProvider');
	const { ICompletionsRelatedFilesProviderService } = await import('../../../extension/completions-core/vscode-node/lib/src/prompt/similarFiles/relatedFiles');
	const { CancellationTokenSource } = await import('vscode-languageserver-protocol');

	class Workspace extends MutableObservableWorkspace { declare _serviceBrand: undefined; }
	class Edits extends FullRecentEditsProvider {
		record(uri: string, contents: string): void {
			(this as unknown as { updateRecentEdits(u: string, c: string): void }).updateRecentEdits(uri, contents);
		}
	}

	const collection = createLibTestingContext();
	const workspace = new Workspace();
	collection.define(ICompletionsObservableWorkspace, workspace as never);
	const edits = new Edits(undefined, workspace as never);
	collection.define(ICompletionsRecentEditsProviderService, edits);
	// The language services have nothing to say about a manuscript; a stub keeps
	// the graph buildable without one.
	collection.define(ICompletionsRelatedFilesProviderService, {
		_serviceBrand: undefined,
		getRelatedFilesResponse: async () => undefined,
		getRelatedFiles: async () => undefined,
	} as never);
	const accessor = collection.createTestingAccessor();

	const tdm = accessor.get(ICompletionsTextDocumentManagerService) as never as {
		init(folders: { uri: string }[]): void;
		setTextDocument(uri: string, languageId: string, text: string): {
			getText(): string;
			positionAt(offset: number): { line: number; character: number };
		};
	};
	tdm.init([{ uri: 'file:///book/' }]);
	tdm.setTextDocument(opts.editedUri, opts.languageId, opts.editedAfter);
	const doc = tdm.setTextDocument(opts.uri, opts.languageId, opts.text);

	edits.config.activeDocDistanceLimitFromCursor = 10;
	edits.record(opts.editedUri, opts.editedBefore);
	edits.record(opts.editedUri, opts.editedAfter);

	const position = doc.positionAt(doc.getText().length);
	const completionState = createCompletionState(doc as never, position);
	const telemetryData = TelemetryWithExp.createEmptyConfigForTesting();
	const factory = accessor.get(IInstantiationService).createInstance(
		TestComponentsCompletionsPromptFactory, undefined, undefined
	) as unknown as {
		createPromptUnsafe(opts: unknown, token: unknown): Promise<{ type: string; prompt: Rendered }>;
	};
	accessor.get(ICompletionsContextProviderBridgeService).schedule(completionState, 'cid', 'opId', telemetryData);

	const result = await factory.createPromptUnsafe(
		{ completionId: 'cid', completionState, telemetryData, promptOpts: { separateContext: false } },
		new CancellationTokenSource().token
	);
	expect(result.type).toBe('prompt');
	return result.prompt;
}

const manuscript = () => promptFor({
	languageId: 'markdown',
	uri: 'file:///book/设定/角色.md',
	text: SHEET,
	editedUri: 'file:///book/正文/第012章.md',
	editedBefore: CHAPTER.replace('「你还是来了。」她说。', ''),
	editedAfter: CHAPTER,
});

describe('the inline-completion prompt for a manuscript', () => {
	it('does not hand the model the chapter it was editing a minute ago', async () => {
		const { prefix } = await manuscript();

		expect(prefix).not.toContain('我靠着档案馆二楼的窗框');
		expect(prefix).not.toContain('recently edited files');
		expect(prefix).not.toContain('IGNORE');
		expect(prefix).not.toMatch(/^\[\]: # [-+@]/m);
	});

	it('names the file in the language the file is named in', async () => {
		const { prefix } = await manuscript();

		expect(prefix).toContain('Path: 设定/角色.md');
		expect(prefix).not.toContain('%E8%AE%BE');
	});

	it('is the file, and ends where the author stopped', async () => {
		const { prefix } = await manuscript();

		expect(prefix).toBe('[]: # Path: 设定/角色.md\n' + SHEET);
	});

	it('still gives code the recent edits it was written for', async () => {
		const { prefix } = await promptFor({
			languageId: 'typescript',
			uri: 'file:///book/src/main.ts',
			text: CODE,
			editedUri: 'file:///book/src/other.ts',
			editedBefore: 'export const a = 1;\n',
			editedAfter: 'export const a = 2;\n',
		});

		expect(prefix).toContain('recently edited files');
		expect(prefix).toContain('export const a = 2;');
	});
});
