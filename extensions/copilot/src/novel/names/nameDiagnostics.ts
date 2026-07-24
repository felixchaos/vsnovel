/*---------------------------------------------------------------------------------------------
 *  VS Novel — name drift diagnostics.
 *--------------------------------------------------------------------------------------------*/

/**
 * Surfaces name drift in the editor.
 *
 * Thin on purpose: every judgement lives in {@link findingsFrom} and
 * {@link NameIndex}, which are testable without a window. What is left here is
 * the editor contract — when to run, what to publish, what to offer.
 *
 * Three decisions in that contract are deliberate:
 *
 *  - **Warning, never error.** The design calls for a yellow underline. Red
 *    reads as "this is broken" and pulls an author out of the sentence they are
 *    writing; drift is a note, not a fault.
 *  - **An observe mode, and it is the default for a new workspace.** A checker
 *    nobody has calibrated yet gets to write to the log and nothing else. Once
 *    an author has seen it be right for a while they can turn the underline on.
 *  - **Debounced, on the document being edited only.** This runs on the
 *    keystroke path, and the cost has to follow the chapter in front of the
 *    author rather than the manuscript behind it.
 */

import * as vscode from 'vscode';
import { ILogService } from '../../platform/log/common/logService';
import { IExtensionContribution } from '../../extension/common/contributions';
import { Disposable, DisposableStore, MutableDisposable } from '../../util/vs/base/common/lifecycle';
import { parseFrontMatter } from '../../util/vs/base/common/yaml';
import type { LangCode } from '../lang';
import { parseCharacter } from './characterFile';
import { findingsFrom, isPositioned, NameFinding } from './nameFindings';
import { NameIndex } from './nameIndex';

/** Where a workspace keeps its cast. */
const CHARACTER_GLOB = 'world/characters/**/*.md';

/** Prose, not code. Everything else is left alone. */
const PROSE_LANGUAGES = new Set(['markdown', 'plaintext']);

/** Long enough that a burst of typing settles, short enough to feel live. */
const DEBOUNCE_MS = 400;

const SOURCE = 'VS Novel';
const CODE_ALIAS_DRIFT = 'novel.aliasDrift';

export type NameCheckMode = 'off' | 'observe' | 'warn';

/** Reads the mode. Observe is the default: a new checker has earned nothing yet. */
function modeFor(resource: vscode.Uri | undefined): NameCheckMode {
	const value = vscode.workspace.getConfiguration('novel', resource).get<string>('nameCheck', 'observe');
	return value === 'off' || value === 'warn' ? value : 'observe';
}

export class NameDiagnosticsContrib extends Disposable implements IExtensionContribution {
	readonly id = 'novel.nameDiagnostics';

	private readonly _collection = this._register(vscode.languages.createDiagnosticCollection('novel-names'));
	private readonly _output = this._register(vscode.window.createOutputChannel(SOURCE, { log: true }));
	private readonly _pending = this._register(new MutableDisposable());
	private _index = NameIndex.build([]);
	/** Findings by document, so the code-action provider can answer without rescanning. */
	private readonly _findings = new Map<string, NameFinding[]>();

	constructor(@ILogService private readonly _logService: ILogService) {
		super();

		this._register(vscode.languages.registerCodeActionsProvider(
			[{ language: 'markdown' }, { language: 'plaintext' }],
			new NameCodeActions(this._findings),
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
		));

		const watcher = this._register(vscode.workspace.createFileSystemWatcher(CHARACTER_GLOB));
		const reload = () => void this.reload();
		this._register(watcher.onDidCreate(reload));
		this._register(watcher.onDidChange(reload));
		this._register(watcher.onDidDelete(reload));
		this._register(vscode.workspace.onDidChangeWorkspaceFolders(reload));

		this._register(vscode.workspace.onDidChangeTextDocument(e => this.schedule(e.document)));
		this._register(vscode.window.onDidChangeActiveTextEditor(editor => editor && this.schedule(editor.document)));
		// A closed document's marks must go with it, or the Problems panel keeps
		// reporting a chapter the author is no longer looking at.
		this._register(vscode.workspace.onDidCloseTextDocument(doc => {
			this._collection.delete(doc.uri);
			this._findings.delete(doc.uri.toString());
		}));

		void this.reload();
	}

	/** Rebuilds the index from the workspace's character files. */
	private async reload(): Promise<void> {
		const characters = [];
		for (const uri of await vscode.workspace.findFiles(CHARACTER_GLOB)) {
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const relative = vscode.workspace.asRelativePath(uri, false);
				const character = parseCharacter(relative, new TextDecoder().decode(bytes), {
					// A malformed character file is the author's to fix, and it is
					// invisible unless something says so — the entry simply stops
					// matching, which reads as the feature not working.
					onProblem: problem => this._output.appendLine(`${relative}: ${problem.field}: ${problem.message}`),
				});
				if (character) {
					characters.push(character);
				}
			} catch (error) {
				this._logService.warn(`[novel-names] could not read ${uri.toString()}: ${error}`);
			}
		}
		this._index = NameIndex.build(characters);
		this._logService.debug(`[novel-names] indexed ${this._index.size} characters`);

		for (const editor of vscode.window.visibleTextEditors) {
			this.schedule(editor.document);
		}
	}

	private schedule(document: vscode.TextDocument): void {
		if (!PROSE_LANGUAGES.has(document.languageId)) {
			return;
		}
		const store = new DisposableStore();
		const timer = setTimeout(() => this.run(document), DEBOUNCE_MS);
		store.add({ dispose: () => clearTimeout(timer) });
		// MutableDisposable cancels the previous timer, so a burst of typing
		// produces one scan rather than one per keystroke.
		this._pending.value = store;
	}

	private run(document: vscode.TextDocument): void {
		const mode = modeFor(document.uri);
		if (mode === 'off' || this._index.size === 0) {
			this._collection.delete(document.uri);
			return;
		}

		const text = document.getText();
		const result = this._index.check(text, chapterContext(text));
		const findings = findingsFrom(result);
		this._findings.set(document.uri.toString(), findings);

		if (mode === 'observe') {
			// Dark ship: the checker gets to be right in the log for a while
			// before it is allowed to interrupt anyone.
			this._collection.delete(document.uri);
			for (const finding of findings) {
				this._output.appendLine(`${vscode.workspace.asRelativePath(document.uri)}: ${describe(finding)}`);
			}
			return;
		}

		this._collection.set(document.uri, findings.filter(isPositioned).map(finding => {
			const diagnostic = new vscode.Diagnostic(
				new vscode.Range(document.positionAt(finding.start), document.positionAt(finding.end)),
				describe(finding),
				vscode.DiagnosticSeverity.Warning,
			);
			diagnostic.source = SOURCE;
			diagnostic.code = CODE_ALIAS_DRIFT;
			diagnostic.relatedInformation = finding.relatedRanges.map(range => new vscode.DiagnosticRelatedInformation(
				new vscode.Location(document.uri, new vscode.Range(document.positionAt(range.start), document.positionAt(range.end))),
				vscode.l10n.t('Also written this way here'),
			));
			return diagnostic;
		}));
	}
}

/**
 * Reads the point of view and cast from a chapter's own frontmatter.
 *
 * Without a POV an address form cannot resolve — 师父 means someone different in
 * every character's scenes — so the chapter has to say whose eyes it is behind.
 * Absent frontmatter simply means no address forms apply, which is the safe
 * direction: it under-reports rather than inventing a referent.
 */
function chapterContext(text: string): { pov?: string; cast?: string[]; lang?: LangCode } {
	const doc = parseFrontMatter(text);
	if (!doc?.header) {
		return {};
	}
	const lang = doc.getStringValue('lang')?.trim();
	return {
		pov: doc.getStringValue('pov')?.trim() || undefined,
		cast: doc.getStringArrayValue('cast')?.filter(c => !!c.trim()),
		lang: lang === 'zh' || lang === 'ja' || lang === 'en' ? lang : undefined,
	};
}

function describe(finding: NameFinding): string {
	if (finding.kind === 'ambiguous') {
		return vscode.l10n.t('"{0}" is registered to more than one character, so it was left unresolved.', finding.surface);
	}
	return vscode.l10n.t('"{0}" appears here but "{1}" is never written in this chapter.', finding.surface, finding.canonical ?? '');
}

/**
 * Offers the fix, and never applies it.
 *
 * The action is opt-in for a reason that is not squeamishness: an alias may be
 * doing work. A chapter that calls him 那男人 until the reveal is using drift
 * deliberately, and a tool that quietly normalised it would have rewritten the
 * scene.
 */
class NameCodeActions implements vscode.CodeActionProvider {
	constructor(private readonly _findings: ReadonlyMap<string, NameFinding[]>) { }

	provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
		const findings = this._findings.get(document.uri.toString()) ?? [];
		const actions: vscode.CodeAction[] = [];

		for (const finding of findings) {
			if (!isPositioned(finding) || !finding.replaceWith) {
				continue;
			}
			const here = new vscode.Range(document.positionAt(finding.start), document.positionAt(finding.end));
			if (!here.intersection(range)) {
				continue;
			}

			actions.push(this.replaceAction(
				vscode.l10n.t('Use "{0}" here', finding.replaceWith),
				document,
				[{ start: finding.start, end: finding.end }],
				finding.replaceWith,
			));

			if (finding.relatedRanges.length > 0) {
				actions.push(this.replaceAction(
					vscode.l10n.t('Use "{0}" everywhere in this chapter ({1})', finding.replaceWith, finding.relatedRanges.length + 1),
					document,
					[{ start: finding.start, end: finding.end }, ...finding.relatedRanges],
					finding.replaceWith,
				));
			}
		}
		return actions;
	}

	private replaceAction(
		title: string,
		document: vscode.TextDocument,
		ranges: readonly { start: number; end: number }[],
		replacement: string,
	): vscode.CodeAction {
		const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
		action.edit = new vscode.WorkspaceEdit();
		for (const range of ranges) {
			action.edit.replace(
				document.uri,
				new vscode.Range(document.positionAt(range.start), document.positionAt(range.end)),
				replacement,
			);
		}
		// Never `isPreferred`: that is what makes an action eligible for
		// apply-on-save and fix-all sweeps, and this one must stay a decision.
		return action;
	}
}
